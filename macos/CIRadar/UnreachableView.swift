import CIRadarKit
import SwiftUI

/// The full-window "Can't reach CI Radar" state, shown for any `APIError`.
struct UnreachableView: View {
  let error: APIError
  let apiBaseURL: URL
  let retry: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label("Can't reach CI Radar", systemImage: "bolt.horizontal.circle")
    } description: {
      Text(markdown: error.explanation(apiBaseURL: apiBaseURL))
    } actions: {
      Button("Retry", action: retry)
    }
  }
}

extension Text {
  /// Renders inline Markdown such as `pnpm api` code spans, falling back to the plain string.
  fileprivate init(markdown: String) {
    if let attributed = try? AttributedString(
      markdown: markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    {
      self.init(attributed)
    } else {
      self.init(verbatim: markdown)
    }
  }
}

#Preview("Unreachable") {
  UnreachableView(
    error: .unreachable(underlying: URLError(.cannotConnectToHost)),
    apiBaseURL: URL(string: "http://localhost:8787")!, retry: {})
    .frame(width: 760, height: 480)
}

#Preview("Server error") {
  UnreachableView(
    error: .server(status: 500, code: "internal", message: "No user found. Run `pnpm seed` first."),
    apiBaseURL: URL(string: "http://localhost:8787")!, retry: {})
    .frame(width: 760, height: 480)
}
