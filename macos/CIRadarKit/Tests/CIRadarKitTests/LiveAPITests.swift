import Foundation
import Synchronization
import Testing

@testable import CIRadarKit

@Suite struct LiveAPITests {
  @Test func decodesRepos() async throws {
    let api = StubURLProtocol.api(.response(status: 200, body: try Fixtures.data(named: "repos.json")))
    let repos = try await api.repos()
    #expect(repos.count == 4)
  }

  @Test func requestsReposUnderTheBaseURL() async throws {
    let api = StubURLProtocol.api(.response(status: 200, body: Data(#"{"repos":[]}"#.utf8)))
    _ = try await api.repos()
    #expect(StubURLProtocol.lastRequestedURL(for: api)?.path() == "/repos")
  }

  @Test func mapsErrorBodyToServerError() async {
    let body = #"{"error":{"code":"internal","message":"No user found. Run `pnpm seed` first."}}"#
    let api = StubURLProtocol.api(.response(status: 500, body: Data(body.utf8)))
    await #expect {
      try await api.repos()
    } throws: { error in
      guard case .server(500, "internal", "No user found. Run `pnpm seed` first.") = error as? APIError else {
        return false
      }
      return true
    }
  }

  @Test func mapsNonContractErrorToServerError() async {
    let api = StubURLProtocol.api(.response(status: 502, body: Data("Bad Gateway".utf8)))
    await #expect {
      try await api.repos()
    } throws: { error in
      guard case .server(502, "unknown", _) = error as? APIError else { return false }
      return true
    }
  }

  @Test func mapsBadBodyToDecodingError() async {
    let api = StubURLProtocol.api(.response(status: 200, body: Data(#"{"repos":[{"id":"one"}]}"#.utf8)))
    await #expect {
      try await api.repos()
    } throws: { error in
      guard case .decoding = error as? APIError else { return false }
      return true
    }
  }

  @Test func mapsTransportFailureToUnreachable() async {
    let api = StubURLProtocol.api(.failure(URLError(.cannotConnectToHost)))
    await #expect {
      try await api.repos()
    } throws: { error in
      guard case .unreachable(let underlying) = error as? APIError else { return false }
      return (underlying as? URLError)?.code == .cannotConnectToHost
    }
  }
}

/// Answers every request to a host with that host's canned stub. Each test gets its own host,
/// so tests running in parallel don't see each other's stubs.
final class StubURLProtocol: URLProtocol {
  enum Stub: Sendable {
    case response(status: Int, body: Data)
    case failure(URLError)
  }

  private struct Entry: Sendable {
    var stub: Stub
    var lastURL: URL?
  }

  private static let entries = Mutex<[String: Entry]>([:])

  static func api(_ stub: Stub) -> LiveAPI {
    let host = "stub-\(UUID().uuidString.lowercased()).test"
    entries.withLock { $0[host] = Entry(stub: stub) }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    return LiveAPI(baseURL: URL(string: "http://\(host)")!, session: URLSession(configuration: configuration))
  }

  static func lastRequestedURL(for api: LiveAPI) -> URL? {
    entries.withLock { $0[api.baseURL.host() ?? ""]?.lastURL }
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func stopLoading() {}

  override func startLoading() {
    guard let url = request.url, let host = url.host() else { return }
    let stub = Self.entries.withLock { entries -> Stub? in
      entries[host]?.lastURL = url
      return entries[host]?.stub
    }
    switch stub {
    case .response(let status, let body):
      let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: body)
      client?.urlProtocolDidFinishLoading(self)
    case .failure(let error):
      client?.urlProtocol(self, didFailWithError: error)
    case nil:
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
    }
  }
}
