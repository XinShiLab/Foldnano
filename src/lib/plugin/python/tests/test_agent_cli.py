"""The agent CLI (agent/run.py, scaffolded as .foldnano/run.py) against a fake editor."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import threading
import time
from pathlib import Path

import pytest

CLI_SOURCE = Path(__file__).resolve().parent.parent / "agent" / "run.py"
SESSION = "s-1"


@pytest.fixture
def folder(tmp_path: Path):
    """A linked folder with run.py where the scaffold puts it, and the module loaded from there."""
    (tmp_path / ".foldnano").mkdir()
    cli_path = tmp_path / ".foldnano" / "run.py"
    shutil.copy(CLI_SOURCE, cli_path)
    spec = importlib.util.spec_from_file_location("foldnano_agent_run", cli_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.POLL_S = 0.02
    return tmp_path, module


def write_listener(root: Path, state="listening", age_s=0.0, protocol=1, session=SESSION, activity="idle"):
    agent = root / ".foldnano" / "agent"
    agent.mkdir(parents=True, exist_ok=True)
    # Swapped in whole, like the editor's createWritable(): run.py never reads half a file.
    temp = agent / ".listener.json.tmp"
    temp.write_text(
        json.dumps(
            {
                "protocol": protocol,
                "pluginId": "p",
                "folderName": root.name,
                "docId": "d",
                "docName": "My design",
                "session": session if state == "listening" else None,
                "state": state,
                "reason": "another tab is editing this design" if state == "paused" else None,
                "activity": activity,
                "requestId": None,
                "heartbeatAt": (time.time() - age_s) * 1000,
            }
        )
    )
    os.replace(temp, agent / "listener.json")


def fake_editor(root: Path, respond, timeout_s=5.0, before_ack=None, later=None):
    """Answers the first request like the editor: ack as running, then the final record.

    `later`: fields the editor adds afterwards, as when the user applies or discards a change.
    """

    def loop():
        requests = root / ".foldnano" / "agent" / "requests"
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            for path in sorted(requests.glob("*.json")) if requests.exists() else []:
                request = json.loads(path.read_text())
                if before_ack:
                    before_ack()
                runs = root / ".foldnano" / "agent" / "runs"
                runs.mkdir(parents=True, exist_ok=True)
                record_path = runs / f"{request['id']}.json"
                record_path.write_text(json.dumps({"id": request["id"], "status": "running"}))
                path.unlink()
                final = {"id": request["id"], "mode": request["mode"], **respond(request)}
                record_path.write_text(json.dumps(final))
                if later:
                    time.sleep(0.15)
                    record_path.write_text(json.dumps({**final, **later}))
                return
            time.sleep(0.01)

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()
    return thread


def test_runs_a_script_with_the_session_and_prints_its_output(folder, capsys):
    root, cli = folder
    (root / "agent-scripts").mkdir()
    (root / "agent-scripts" / "01-look.py").write_text("def run(ctx): pass\n")
    write_listener(root)
    seen = {}

    def respond(request):
        seen.update(request)
        return {
            "status": "done",
            "logs": ["12 helices"],
            "applyOutcome": "applied",
            "summary": "replayMutationLog — 3 ops",
            "durationMs": 1200,
        }

    thread = fake_editor(root, respond)
    code = cli.main([str(root / "agent-scripts" / "01-look.py"), "--param", "n=3", "--param", "tag=x"])
    thread.join()
    assert code == 0
    assert seen["session"] == SESSION
    assert seen["script"] == "agent-scripts/01-look.py"
    assert seen["params"] == {"n": 3, "tag": "x"}
    assert seen["mode"] == "apply"
    captured = capsys.readouterr()
    assert "12 helices" in captured.out
    assert "applied (one undo step)" in captured.out
    assert 'running on the design "My design"' in captured.err


@pytest.mark.parametrize(
    ("outcome", "args", "code"),
    [
        ("applied", [], 0),
        ("nothing", [], 0),
        ("stale", [], 1),
        ("pending-review", [], 1),
        ("dry-run", ["--dry-run"], 0),
        ("stale", ["--dry-run"], 1),
        ("nothing", ["--ask-user-approval"], 0),
    ],
)
def test_exit_code_follows_what_happened_to_the_result(folder, capsys, outcome, args, code):
    root, cli = folder
    write_listener(root)
    thread = fake_editor(root, lambda _r: {"status": "done", "applyOutcome": outcome})
    assert cli.main(args) == code
    thread.join()


def test_sends_the_mode(folder):
    root, cli = folder
    for args, mode in (([], "apply"), (["--dry-run"], "dry-run"), (["--ask-user-approval"], "ask-user")):
        write_listener(root)
        seen = {}
        thread = fake_editor(root, lambda r: seen.update(r) or {"status": "done", "applyOutcome": "nothing"})
        cli.main(args)
        thread.join()
        assert seen["mode"] == mode


@pytest.mark.parametrize(
    ("review", "code", "label"),
    [
        ("applied", 0, "applied by the user"),
        ("discarded", 1, "NOT applied: the user discarded it"),
        ("stale", 1, "the design changed before the user applied it"),
    ],
)
def test_ask_user_approval_waits_for_the_users_decision(folder, capsys, review, code, label):
    root, cli = folder
    write_listener(root)
    thread = fake_editor(
        root,
        lambda _r: {"status": "done", "applyOutcome": "pending-review", "review": None},
        later={"review": review},
    )
    assert cli.main(["--ask-user-approval"]) == code
    thread.join()
    captured = capsys.readouterr()
    assert "Waiting for the user to Apply or Discard this change" in captured.err
    assert label in captured.out


def test_ask_user_approval_gives_up_without_suggesting_a_rerun(folder, capsys):
    root, cli = folder
    write_listener(root)
    thread = fake_editor(
        root, lambda _r: {"status": "done", "applyOutcome": "pending-review", "review": None}
    )
    assert cli.main(["--ask-user-approval", "--timeout", "0.3"]) == cli.EXIT_NOT_LISTENING
    thread.join()
    assert "Don't run the script again" in capsys.readouterr().err


def test_no_apply_is_refused_with_what_to_use_instead(folder, capsys):
    root, cli = folder
    write_listener(root)
    assert cli.main(["--no-apply"]) == cli.EXIT_USAGE
    err = capsys.readouterr().err
    assert "--dry-run" in err and "--ask-user-approval" in err
    assert not (root / ".foldnano" / "agent" / "requests").exists()


def test_dry_run_and_approval_cannot_be_combined(folder):
    _root, cli = folder
    with pytest.raises(SystemExit):
        cli.main(["--dry-run", "--ask-user-approval"])


@pytest.mark.parametrize("status", ["error", "rejected", "cancelled", "interrupted"])
def test_unsuccessful_runs_exit_1_with_the_error(folder, capsys, status):
    root, cli = folder
    write_listener(root)
    thread = fake_editor(
        root,
        lambda _r: {"status": status, "error": "ValueError: bad", "traceback": 'File "p/plugin.py"'},
    )
    assert cli.main([]) == 1
    thread.join()
    err = capsys.readouterr().err
    assert f"{status}: ValueError: bad" in err


def test_keeps_waiting_while_the_editor_is_busy(folder, capsys):
    root, cli = folder
    write_listener(root, activity="awaiting-review")

    def review_then_ack():
        time.sleep(0.2)
        write_listener(root)

    thread = fake_editor(root, lambda _r: {"status": "done", "applyOutcome": "applied"}, before_ack=review_then_ack)
    assert cli.main([]) == 0
    thread.join()
    assert "Waiting for the user to Apply or Discard" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("listener", "message"),
    [
        (None, "No Foldnano tab has listened"),
        ({"age_s": 60}, "No Foldnano tab is listening"),
        ({"state": "stopped"}, "No Foldnano tab is listening"),
        ({"state": "paused"}, "another tab is editing"),
    ],
)
def test_refuses_to_start_without_a_listening_editor(folder, capsys, listener, message):
    root, cli = folder
    if listener is not None:
        write_listener(root, **listener)
    assert cli.main([]) == 2
    assert message in capsys.readouterr().err
    assert not (root / ".foldnano" / "agent" / "requests").exists()


def test_a_protocol_mismatch_is_a_usage_error(folder, capsys):
    root, cli = folder
    write_listener(root, protocol=2)
    assert cli.main([]) == 3
    assert "protocol 2" in capsys.readouterr().err


def test_takes_the_request_back_when_the_editor_goes_away(folder, capsys):
    root, cli = folder
    write_listener(root, age_s=14.5)
    assert cli.main([]) == 2
    assert list((root / ".foldnano" / "agent" / "requests").glob("*.json")) == []
    assert "No Foldnano tab is listening" in capsys.readouterr().err


def test_takes_the_request_back_when_the_session_changes(folder, capsys):
    root, cli = folder
    write_listener(root)

    def restart():
        time.sleep(0.1)
        write_listener(root, session="s-2")

    threading.Thread(target=restart, daemon=True).start()
    assert cli.main([]) == 2
    assert list((root / ".foldnano" / "agent" / "requests").glob("*.json")) == []
    assert "new session" in capsys.readouterr().err


def test_refuses_a_script_outside_the_folder(folder, tmp_path_factory):
    root, cli = folder
    write_listener(root)
    outside = tmp_path_factory.mktemp("elsewhere") / "x.py"
    outside.write_text("")
    with pytest.raises(SystemExit, match="not inside the linked folder"):
        cli.main([str(outside)])


OVERVIEW = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "design_overview.golden.json").read_text()
)


def test_formats_the_overview_the_editor_builds(folder):
    _root, cli = folder
    text = "\n".join(cli.format_overview(OVERVIEW))
    assert 'region "HONEYCOMB Region 1" (honeycomb), 2 helices, bp 0–41' in text
    assert "helices, number(row,col): 0(0,0)  1(0,1)" in text
    assert "scaffold: 84 nt, linear, 2 segments, 1 crossover" in text
    assert "helix order: 0 → 1" in text
    assert "route 5'→3': 0[0→41]  1[41→0]" in text
    assert "unpaired 4 nt: 0[26→29]" in text
    assert "staples: 3, 12–42 nt (median 26), 1 outside 15–60 nt" in text
    assert "outside 15–60 nt, by 5' end: 0[41] 12 nt" in text
    assert 'other region: "Side arm" (freeform, 0 helices)' in text
    assert text.splitlines()[1].startswith("  helices")


def test_cut_lists_say_how_many_more(folder):
    _root, cli = folder
    overview = json.loads(json.dumps(OVERVIEW))
    overview["scaffolds"][0]["segmentCount"] = 70
    overview["region"]["helixCount"] = 90
    text = "\n".join(cli.format_overview(overview))
    assert "… 68 more" in text
    assert "… 88 more" in text


def test_prints_the_overview_after_a_run_unless_asked_not_to(folder, capsys):
    root, cli = folder
    for args, shown in (([], True), (["--no-overview"], False)):
        write_listener(root)
        thread = fake_editor(
            root, lambda _r: {"status": "done", "applyOutcome": "applied", "overview": OVERVIEW}
        )
        assert cli.main(args) == 0
        thread.join()
        assert ("design now:" in capsys.readouterr().out) is shown


def test_a_dry_runs_overview_is_the_design_as_it_would_be(folder, capsys):
    root, cli = folder
    write_listener(root)
    thread = fake_editor(
        root, lambda _r: {"status": "done", "applyOutcome": "dry-run", "overview": OVERVIEW}
    )
    assert cli.main(["--dry-run"]) == 0
    thread.join()
    out = capsys.readouterr().out
    assert "dry run: the design was not changed" in out
    assert "[foldnano] design if applied (dry run; nothing changed): region" in out


def test_describe_asks_for_the_overview_only(folder, capsys):
    root, cli = folder
    write_listener(root)
    seen = {}

    def respond(request):
        seen.update(request)
        return {"kind": "describe", "status": "done", "overview": OVERVIEW, "durationMs": 3}

    thread = fake_editor(root, respond)
    assert cli.main(["--describe"]) == 0
    thread.join()
    assert seen["kind"] == "describe"
    assert seen["script"] is None
    captured = capsys.readouterr()
    assert captured.out.startswith("[foldnano] design now:")
    assert "done" not in captured.out.splitlines()[0]
    assert 'describing the design "My design"' in captured.err


def test_describe_takes_no_script_or_params(folder, capsys):
    root, cli = folder
    write_listener(root)
    assert cli.main(["--describe", "--param", "n=1"]) == cli.EXIT_USAGE
    assert not (root / ".foldnano" / "agent" / "requests").exists()
