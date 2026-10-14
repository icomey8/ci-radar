import Foundation
import Testing

@testable import CIRadarKit

@Suite struct APIErrorTests {
  let baseURL = URL(string: "http://localhost:8787")!

  @Test func unreachableNamesTheBaseURLAndHowToStartTheAPI() {
    let error = APIError.unreachable(underlying: URLError(.cannotConnectToHost))
    #expect(
      error.explanation(apiBaseURL: baseURL)
        == "No response from the API at http://localhost:8787. Start it with `pnpm api` (and Postgres with `docker compose up`)."
    )
  }

  @Test func serverErrorShowsTheAPIMessage() {
    let error = APIError.server(status: 500, code: "internal", message: "No user found. Run `pnpm seed` first.")
    #expect(error.explanation(apiBaseURL: baseURL) == "No user found. Run `pnpm seed` first.")
  }

  @Test func decodingErrorShowsItsMessage() {
    let error = APIError.decoding("Unexpected response from http://localhost:8787/repos")
    #expect(error.explanation(apiBaseURL: baseURL) == "Unexpected response from http://localhost:8787/repos")
  }
}
