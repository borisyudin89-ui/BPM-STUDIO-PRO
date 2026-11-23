'use strict';
// macOS: бесплатная «самоподпись» (ad-hoc), без неё сборка для Apple Silicon не запускается («приложение повреждено»).
// Платной подписи Apple нет, поэтому при первом запуске система покажет предупреждение «неизвестный разработчик» (см. README).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  const ffmpeg = path.join(app, 'Contents', 'Resources', 'app', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (fs.existsSync(ffmpeg)) {
    fs.chmodSync(ffmpeg, 0o755);
    execFileSync('codesign', ['--force', '--sign', '-', ffmpeg], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--verbose=2', app], { stdio: 'inherit' });
};
