import CIRadarKit
import SwiftUI

extension RepoStatus {
  /// The semantic tint for flaky (orange) and broken (red), wherever either appears.
  var tint: Color {
    switch self {
    case .flaky: .orange
    case .broken: .red
    }
  }
}
