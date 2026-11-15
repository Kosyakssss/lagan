// The app as a macOS launch agent: started at login, started again if it
// stops, run from this copy of the repo with its own data. Installing writes
// the agent and starts it; uninstalling stops it and takes it away. The data
// stays either way.
import { homedir } from 'node:os';
import { join } from 'node:path';

const LABEL = 'org.sk.lagan';
const ROOT = join(import.meta.dir, '..');
const LOG = join(ROOT, 'data/server.log');
const PLIST = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const STARTING = 15_000;

const domain = () => `gui/${process.getuid!()}`;
const escape = (text: string) => Bun.escapeHTML(text);

const plist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(process.execPath)}</string>
    <string>src/server.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escape(ROOT)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escape(LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${escape(LOG)}</string>
</dict>
</plist>
`;

function launchctl(...args: string[]): { ok: boolean; said: string } {
  const { exitCode, stdout, stderr } = Bun.spawnSync(['launchctl', ...args]);
  return { ok: exitCode === 0, said: `${stdout}${stderr}`.trim() };
}

const logSize = async () => ((await Bun.file(LOG).exists()) ? Bun.file(LOG).size : 0);

// Waits for the app to say where it is, in what the log gained since `from`.
async function started(from: number): Promise<string> {
  const deadline = Date.now() + STARTING;
  let gained = '';
  while (Date.now() < deadline) {
    await Bun.sleep(200);
    gained = (await Bun.file(LOG).exists()) ? await Bun.file(LOG).slice(from).text() : '';
    const at = /^Lagan at (\S+)/m.exec(gained)?.[1];
    if (at) return at;
  }
  throw new Error(`Lagan didn’t start. Its log, ${LOG}, says:\n${gained.trim().split('\n').slice(-10).join('\n')}`);
}

export async function install(): Promise<void> {
  await Bun.$`mkdir -p ${join(ROOT, 'data')} ${join(homedir(), 'Library/LaunchAgents')}`.quiet();
  launchctl('bootout', `${domain()}/${LABEL}`); // installed already: replaced
  await Bun.write(PLIST, plist());
  const from = await logSize();
  const loaded = launchctl('bootstrap', domain(), PLIST);
  if (!loaded.ok) throw new Error(`Couldn’t start ${LABEL}: ${loaded.said}`);
  console.log(`Lagan runs at login now, from ${ROOT}, at ${await started(from)}`);
}

export async function uninstall(): Promise<void> {
  const stopped = launchctl('bootout', `${domain()}/${LABEL}`);
  const file = Bun.file(PLIST);
  const had = await file.exists();
  if (had) await file.delete();
  if (!stopped.ok && !had) return void console.log('Lagan wasn’t installed');
  console.log(`Lagan is stopped and no longer runs at login. Its data stays in ${join(ROOT, 'data')}`);
}

export async function restart(): Promise<void> {
  const from = await logSize();
  const kicked = launchctl('kickstart', '-k', `${domain()}/${LABEL}`);
  if (!kicked.ok) throw new Error(`Lagan isn’t installed: lagan install sets it up (${kicked.said})`);
  console.log(`Restarted Lagan, at ${await started(from)}`);
}
