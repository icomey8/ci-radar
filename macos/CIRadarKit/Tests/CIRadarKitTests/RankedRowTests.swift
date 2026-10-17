import Testing

@testable import CIRadarKit

@Suite struct RankedRowTests {
  @Test func aTestRowIsNamedForItsTestAndLocatedByWorkflowAndJob() {
    let row = RankedRow(
      kind: .test(name: "tests.test_net::test_retry_timeout"), workflowName: "ci", jobName: "test (3.11)",
      failures: 9, runs: 48)
    #expect(row.name == "tests.test_net::test_retry_timeout")
    #expect(row.location == "ci / test (3.11)")
    #expect(row.kind.label == "TEST")
  }

  @Test func aJobRowIsNamedForItsJobAndLocatedByWorkflow() {
    let row = RankedRow(kind: .job, workflowName: "release", jobName: "publish-docs", failures: 19, runs: 20)
    #expect(row.name == "publish-docs")
    #expect(row.location == "release")
    #expect(row.kind.label == "JOB")
  }

  @Test func failureRateIsFailuresOverRuns() {
    let row = RankedRow(kind: .job, workflowName: "e2e", jobName: "playwright", failures: 6, runs: 31)
    #expect(abs(row.failureRate - 0.19355) < 0.00001)
  }
}
