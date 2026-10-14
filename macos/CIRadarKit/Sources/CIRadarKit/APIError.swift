import Foundation


/// Everything that can go wrong talking to the CI Radar API.
public enum APIError: Error {
  /// No HTTP response at all: the API isn't running, or the connection failed.
  case unreachable(underlying: any Error)
  /// The API answered with a non-2xx status.
  case server(status: Int, code: String, message: String)
  /// The API answered 2xx, but the body didn't match the contract.
  case decoding(String)
}

extension APIError {
  /// What the "Can't reach CI Radar" state says about this error (spec §6).
  public func explanation(apiBaseURL: URL) -> String {
    switch self {
    case .unreachable:
      "No response from the API at \(apiBaseURL.absoluteString). Start it with `pnpm api` (and Postgres with `docker compose up`)."
    case .server(_, _, let message), .decoding(let message):
      message
    }
  }
}
