import AppKit
import CIRadarKit
import SwiftUI

/// One ranked job or test: its name and where it runs on the left, how often it failed on the right.
struct RankingRow: View {
  /// Which section a row is in, and its place there.
  enum Placement {
    /// Numbered by its place in rank()'s order.
    case flaky(number: Int)
    /// Unnumbered: broken rows aren't ranked against each other.
    case broken

    var status: RepoStatus {
      switch self {
      case .flaky: .flaky
      case .broken: .broken
      }
    }

    var numberLabel: String {
      switch self {
      case .flaky(let number): "\(number)."
      case .broken: ""
      }
    }
  }

  let row: RankedRow
  let placement: Placement

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      // Broken rows keep the empty gutter so every name lines up.
      Text(placement.numberLabel)
        .font(.callout)
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .frame(width: 24, alignment: .trailing)

      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(row.name)
            .font(.callout.weight(.medium))
            .lineLimit(1)
            .truncationMode(.middle)
            .help(row.name)
          KindTag(kind: row.kind)
        }
        Text(row.location)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .help(row.location)
      }

      Spacer(minLength: 16)

      VStack(alignment: .trailing, spacing: 2) {
        Text("^[\(row.failures) failure](inflect: true)")
          .font(.callout.weight(.semibold))
          .foregroundStyle(placement.status.tint)
        Text("of \(row.runs) runs · \(row.failureRate, format: .percent.precision(.fractionLength(1)))")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .monospacedDigit()
      .fixedSize()
    }
    .padding(.vertical, 4)
    .contextMenu {
      Button("Copy name") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(row.name, forType: .string)
      }
    }
  }
}

/// TEST or JOB, as a small capsule beside the name.
private struct KindTag: View {
  let kind: RankedRow.Kind

  var body: some View {
    Text(kind.label)
      .font(.caption2.weight(.semibold))
      .foregroundStyle(.secondary)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.quaternary, in: .capsule)
      .fixedSize()
  }
}

#Preview {
  List {
    RankingRow(
      row: RankedRow(
        kind: .test(name: "tests.test_net::test_retry_timeout"), workflowName: "ci", jobName: "test (3.11)",
        failures: 9, runs: 48),
      placement: .flaky(number: 1))
    RankingRow(
      row: RankedRow(kind: .job, workflowName: "e2e", jobName: "playwright (chromium)", failures: 1, runs: 12),
      placement: .flaky(number: 2))
    RankingRow(
      row: RankedRow(kind: .job, workflowName: "release", jobName: "publish-docs", failures: 19, runs: 20),
      placement: .broken)
  }
  .frame(width: 560)
}
