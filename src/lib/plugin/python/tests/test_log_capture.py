"""LogCapture turns print() writes into one log entry per printed line."""

from __future__ import annotations

import contextlib

from foldnano._log_capture import MAX_LOG_LINE_CHARS, MAX_LOG_LINES, LogCapture


def _capture(fn) -> list[str]:
    cap = LogCapture()
    with contextlib.redirect_stdout(cap):
        fn()
    return cap.get_lines()


def test_print_with_several_arguments_is_one_line():
    assert _capture(lambda: print("a", "b", 3)) == ["a b 3"]


def test_embedded_newlines_split_into_lines():
    assert _capture(lambda: print("first\nsecond")) == ["first", "second"]


def test_blank_lines_are_dropped_but_indentation_is_kept():
    def body():
        print()
        print("   ")
        print("  indented")

    assert _capture(body) == ["  indented"]


def test_line_built_across_prints_with_end():
    def body():
        print("progress:", end=" ")
        print("done")

    assert _capture(body) == ["progress: done"]


def test_unterminated_last_line_is_kept():
    assert _capture(lambda: print("no newline", end="")) == ["no newline"]


def test_clear_drops_partial_line():
    cap = LogCapture()
    cap.write("left over")
    cap.clear()
    assert cap.get_lines() == []


def test_keeps_at_most_max_lines_and_reports_the_rest():
    def body():
        for i in range(MAX_LOG_LINES + 250):
            print(i)

    lines = _capture(body)
    assert len(lines) == MAX_LOG_LINES + 1
    assert lines[MAX_LOG_LINES - 1] == str(MAX_LOG_LINES - 1)
    assert lines[-1] == "[output truncated: 250 more lines not shown]"


def test_truncates_a_very_long_line():
    lines = _capture(lambda: print("x" * (MAX_LOG_LINE_CHARS + 50)))
    assert lines == ["x" * MAX_LOG_LINE_CHARS + "… [line truncated]"]


def test_truncates_a_long_line_written_without_newlines():
    def body():
        for _ in range(MAX_LOG_LINE_CHARS):
            print("ab", end="")

    lines = _capture(body)
    assert len(lines) == 1 and lines[0].endswith("… [line truncated]")


def test_sink_receives_each_kept_line_as_it_completes():
    cap = LogCapture()
    streamed: list[str] = []
    cap.set_sink(streamed.append)
    with contextlib.redirect_stdout(cap):
        print("one")
        assert streamed == ["one"]
        print("", end="")
        print("two", end="")
    assert streamed == ["one"]
    assert cap.get_lines() == ["one", "two"]
    assert streamed == ["one", "two"]
    cap.set_sink(None)
    with contextlib.redirect_stdout(cap):
        print("three")
    assert streamed == ["one", "two"]
