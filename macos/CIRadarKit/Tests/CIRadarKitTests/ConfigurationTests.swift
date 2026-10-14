import Foundation
import Testing

@testable import CIRadarKit

@Suite struct ConfigurationTests {
  @Test func defaultsToLocalhost() throws {
    let defaults = try #require(UserDefaults(suiteName: "ConfigurationTests-\(UUID())"))
    #expect(Configuration.apiBaseURL(from: defaults) == URL(string: "http://localhost:8787"))
  }

  @Test func honoursTheAPIBaseURLDefault() throws {
    let defaults = try #require(UserDefaults(suiteName: "ConfigurationTests-\(UUID())"))
    defaults.set("http://localhost:9999", forKey: "apiBaseURL")
    #expect(Configuration.apiBaseURL(from: defaults) == URL(string: "http://localhost:9999"))
  }
}
