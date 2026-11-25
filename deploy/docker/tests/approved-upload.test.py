#!/usr/bin/env python3
import errno
import hashlib
import json
import os
import pty
import select
import shlex
import shutil
import signal
import sys
import tempfile
import time
import unittest
from pathlib import Path


def compose_fixture(args):
    assert args.pop(0) == 'compose'
    root = Path(os.environ['GHMAAS_TEST_DIRECTORY'])
    state = root / 'state.json'
    settings = json.loads(state.read_text())
    baseline = [{'id': 8, 'entryId': 23, 'title': 'Existing track'}]
    new_entry = {'id': 9, 'entryId': 24, 'title': 'Approved track'}
    has_upload = (root / 'uploaded').exists()
    assigned = (root / 'assigned').exists()

    if args[0] == 'config':
        mode = 'persistent' if (root / 'persistent-config').exists() else 'read-only'
        print(json.dumps({'services': {'backend': {'environment': {
            'ADMIN_MANAGEMENT_MODE': mode, 'ADMIN_ALLOW_WRITES': 'false',
        }}}}))
    elif args[0] == 'up':
        assert args[-1] == 'backend' and '--no-deps' in args and '--no-build' in args and '--wait' in args
        assert os.environ['GHMAAS_ADMIN_MANAGEMENT_MODE'] == 'read-only'
        writes = os.environ['GHMAAS_ADMIN_ALLOW_WRITES'] == 'true'
        digest = os.environ['GHMAAS_APPROVED_UPLOAD_SHA256']
        deadline = os.environ['GHMAAS_WRITE_WINDOW_EXPIRES_AT']
        with (root / 'events').open('a') as log:
            print('open' if writes else 'restore', file=log)
        if writes:
            remaining = int(deadline) - int(time.time() * 1000)
            assert 0 < remaining <= 20 * 60_000
            if not (root / 'short-deadline').exists():
                assert remaining > 19 * 60_000
            assert digest == hashlib.sha256((root / 'approved.mp3').read_bytes()).hexdigest()
        else:
            assert not digest and not deadline
            if (root / 'fail-restore').exists():
                return 1
        state.write_text(json.dumps({'writes': writes, 'digest': digest, 'deadline': deadline}))
        if writes and (root / 'fail-activation').exists():
            return 1
    elif args[0] == 'exec' and '--upload' in args:
        payload = sys.stdin.buffer.read()
        filename, size = args[-2:]
        assert int(size) == len(payload)
        print(json.dumps({'entries': baseline, 'upload': {'filename': filename, 'size': len(payload),
                                                         'sha256': hashlib.sha256(payload).hexdigest()}}))
    elif args[0] == 'exec' and '--snapshot' in args:
        entries = baseline + ([new_entry] if assigned else [])
        if (root / 'reorder').exists():
            entries.reverse()
        print(json.dumps({'entries': entries}))
    elif args[0] == 'exec' and '-e' in args:
        source = args[args.index('-e') + 1]
        if 'correctMode' in source:
            if args[-1] == 'read-only':
                assert not settings['writes'] and not settings['digest'] and not settings['deadline']
            else:
                assert args[-3:] == ['window', settings['digest'], settings['deadline']]
                assert settings['writes']
        else:
            assert 'listMedia(digest' in source and not settings['writes']
            print(json.dumps({'id': 9, 'assigned': assigned} if has_upload else None))
    else:
        raise AssertionError('Unexpected Compose fixture invocation')
    return 0


class ApprovedUploadWindow(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='ghmaas-upload-test.')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        docker_dir = self.root / 'deploy/docker'
        docker_dir.mkdir(parents=True)
        source = Path(__file__).resolve().parents[1] / 'approved-upload.sh'
        shutil.copyfile(source, docker_dir / source.name)
        (docker_dir / 'smoke-test.mjs').write_text('console.log("Fixture health and public smoke completed.")\n')
        (self.root / 'backend').mkdir()
        (self.root / 'backend/.env').touch()
        self.file = self.root / 'approved.mp3'
        self.file.write_bytes(b'isolated approved upload fixture')
        self.digest = hashlib.sha256(self.file.read_bytes()).hexdigest()
        self.approval = f'APPROVE {self.digest} ADD TO 2'
        (self.root / 'state.json').write_text(json.dumps({'writes': False, 'digest': '', 'deadline': ''}))
        tools = self.root / 'bin'
        tools.mkdir()
        fixture = tools / 'docker'
        fixture.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(Path(__file__).resolve()))} --compose-fixture "$@"\n')
        fixture.chmod(0o700)
        node = tools / 'node'
        native_node = shlex.quote(shutil.which('node'))
        node.write_text(f'''#!/bin/sh
if [ -f "$GHMAAS_TEST_DIRECTORY/short-deadline" ] && [ "$1" = -p ] && [ "$2" = 'Date.now() + 20 * 60_000' ]; then
  exec {native_node} -p 'Date.now() + 1700'
fi
exec {native_node} "$@"
''')
        node.chmod(0o700)
        self.env = dict(os.environ, PATH=f'{tools}:{os.environ["PATH"]}', TMPDIR=scratch.name,
                        GHMAAS_TEST_DIRECTORY=scratch.name)

    def start(self, expected='Approval > '):
        self.output = bytearray()
        self.cursor = 0
        self.pid, self.terminal = pty.fork()
        if self.pid == 0:
            os.chdir(self.root)
            os.execvpe('bash', ['bash', 'deploy/docker/approved-upload.sh', 'window', str(self.file)], self.env)
        self.addCleanup(self.terminate)
        self.expect(expected)

    def terminate(self):
        if self.pid:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        os.close(self.terminal)

    def read_output(self):
        if not select.select([self.terminal], [], [], 0.1)[0]:
            return
        try:
            self.output.extend(os.read(self.terminal, 16384))
        except OSError as exc:
            if exc.errno != errno.EIO:
                raise

    def expect(self, message):
        expected = message.encode()
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            pos = self.output.find(expected, self.cursor)
            if pos >= 0:
                self.cursor = pos + len(expected)
                return
            self.read_output()
        self.fail(f'Missing {message!r} in terminal output:\n{self.output.decode(errors="replace")}')

    def finish(self, expected):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            self.read_output()
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.pid = 0
                self.assertEqual(os.waitstatus_to_exitcode(status), expected, self.output.decode(errors='replace'))
                return
        self.fail('Upload window script did not exit')

    def send(self, line):
        os.write(self.terminal, (line + '\n').encode())

    def activate(self):
        self.start()
        self.send(self.approval)
        self.expect('UPLOAD WINDOW ACTIVE')
        self.expect('Approved filename:')
        self.expect('Approved SHA-256:')
        self.expect('Type CLOSE to finish > ')
        self.assertTrue(self.write_state())

    def write_state(self):
        return json.loads((self.root / 'state.json').read_text())['writes']

    def test_incorrect_approval_never_activates(self):
        self.start()
        self.send('APPROVE ' + '0' * 64 + ' ADD TO 2')
        self.expect('Approval did not match.')
        self.finish(1)
        self.assertFalse(self.write_state())
        self.assertFalse((self.root / 'events').exists())

    def test_saved_persistent_mode_refuses_temporary_activation(self):
        (self.root / 'persistent-config').touch()
        self.start('Start with the saved Compose backend configuration in read-only mode.')
        self.finish(1)
        self.assertFalse((self.root / 'events').exists())

    def test_only_exact_close_finishes_and_reports_assignment(self):
        self.activate()
        for line in ('', '  ', self.approval, 'random text', ' CLOSE ', 'CLOSE\t', '\x1b[200~CLOSE\x1b[201~'):
            with self.subTest(line=line):
                self.send(line)
                self.expect('Input ignored.')
                self.expect('Type CLOSE to finish > ')
                self.assertTrue(self.write_state())
                self.assertEqual((self.root / 'events').read_text(), 'open\n')
        (self.root / 'uploaded').touch()
        (self.root / 'assigned').touch()
        self.send('CLOSE')
        self.expect('verified read-only')
        self.expect('File upload: Verified AzuraCast media ID 9')
        self.expect('Playlist 2 assignment: Verified one appended entry')
        self.expect('On-air playback of the approved file: NOT TESTED')
        self.expect('Fixture health and public smoke completed.')
        self.finish(0)
        self.assertFalse(self.write_state())

    def test_sigint_restores(self):
        self.activate()
        os.kill(self.pid, signal.SIGINT)
        self.expect('verified read-only')
        self.finish(130)
        self.assertFalse(self.write_state())

    def test_sigterm_restores(self):
        self.activate()
        os.kill(self.pid, signal.SIGTERM)
        self.expect('verified read-only')
        self.finish(143)
        self.assertFalse(self.write_state())

    def test_terminal_eof_restores(self):
        self.activate()
        os.write(self.terminal, b'\x04')
        self.expect('Terminal input closed.')
        self.expect('verified read-only')
        self.finish(1)
        self.assertFalse(self.write_state())

    def test_failed_activation_restores(self):
        (self.root / 'fail-activation').touch()
        self.start()
        self.send(self.approval)
        self.expect('verified read-only')
        self.finish(1)
        self.assertFalse(self.write_state())

    def test_failed_restoration_reports_recovery(self):
        self.activate()
        (self.root / 'fail-restore').touch()
        self.send('CLOSE')
        self.expect('SECURITY WARNING: COULD NOT VERIFY READ-ONLY RESTORATION.')
        self.expect('docker compose up -d --no-deps --no-build --wait --wait-timeout 60 backend')
        self.finish(1)
        self.assertTrue(self.write_state())
        self.assertEqual(len(list(self.root.glob('ghmaas-upload.*/recovery.txt'))), 1)

    def test_deadline_notifies_and_waits_for_close(self):
        (self.root / 'short-deadline').touch()
        self.activate()
        self.expect('Write deadline reached. The server rejects new writes.')
        self.expect('Type CLOSE to finish > ')
        self.send('')
        self.expect('Input ignored.')
        self.send('CLOSE')
        self.expect('verified read-only')
        self.expect('File upload: Approved media record not found')
        self.expect('Playlist 2 assignment: The rotation has no new entry.')
        self.finish(0)
        self.assertFalse(self.write_state())

    def test_rotation_report_rejects_reordered_entries(self):
        self.activate()
        for flag in ('uploaded', 'assigned', 'reorder'):
            (self.root / flag).touch()
        self.send('CLOSE')
        self.expect('verified read-only')
        self.expect('Unexpected rotation change')
        self.finish(1)
        self.assertFalse(self.write_state())


if __name__ == '__main__':
    if sys.argv[1:2] == ['--compose-fixture']:
        sys.exit(compose_fixture(sys.argv[2:]))
    unittest.main(verbosity=2)
