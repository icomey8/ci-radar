import Foundation

/// The CI Radar HTTP API, as the app sees it.
public protocol CIRadarAPI: Sendable {
  func repos() async throws(APIError) -> [Repo]
}

/// Talks to a running `pnpm api` over HTTP.
public struct LiveAPI: CIRadarAPI {
  public let baseURL: URL
  let session: URLSession

  public init(baseURL: URL, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.session = session
  }

  public func repos() async throws(APIError) -> [Repo] {
    try await get("repos", as: ReposResponse.self).repos
  }

  private func get<Body: Decodable>(_ path: String, as _: Body.Type) async throws(APIError) -> Body {
    let url = baseURL.appending(path: path)
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(from: url)
    } catch {
      throw .unreachable(underlying: error)
    }

    let decoder = JSONDecoder.ciRadar()
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      if let body = try? decoder.decode(ErrorBody.self, from: data) {
        throw .server(status: status, code: body.error.code, message: body.error.message)
      }
      throw .server(
        status: status, code: "unknown", message: "The API at \(url.absoluteString) returned HTTP \(status).")
    }

    do {
      return try decoder.decode(Body.self, from: data)
    } catch {
      throw .decoding("Unexpected response from \(url.absoluteString): \(error)")
    }
  }
}
