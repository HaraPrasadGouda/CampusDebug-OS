// Dev helper (not a test): serve the built app on the mock DB + fake clock for screenshots.
// usage: node test/up.mjs  -> prints {"base":..., "nowFile":...}; clock changes: write the "now" file.
import { startApp } from './harness.mjs';
const app = await startApp({ dist: true, profilesFile: process.env.PROFILES_FILE || '', attendanceFile: process.env.ATTENDANCE_FILE || '', timetableFile: process.env.TIMETABLE_FILE || '' });
app.clock(process.argv[2] || '10:30');
console.log(JSON.stringify({ base: app.base, nowFile: app.dir + '/now.txt', dir: app.dir, mock: app.mockPort }));
setInterval(() => {}, 1 << 30);
