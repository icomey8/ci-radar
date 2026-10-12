/// Everything that can go wrong talking to the CI Radar API.
public enum APIError: Error {
  /// No HTTP response at all: the API isn't running, or the connection failed.
  case unreachable(underlying: any Error)
  /// The API answered with a non-2xx status.
  case server(status: Int, code: String, message: String)
  /// The API answered 2xx, but the body didn't match the contract.
  case decoding(String)
}
