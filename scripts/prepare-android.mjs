// Ajusta o projeto Android gerado pelo Capacitor:
// permissão de microfone e acesso ao serviço de reconhecimento de voz.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'android/app/src/main/AndroidManifest.xml';
let xml = readFileSync(path, 'utf8');

if (!xml.includes('android.permission.RECORD_AUDIO')) {
  xml = xml.replace(
    '</manifest>',
    '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n</manifest>',
  );
}
if (!xml.includes('android.speech.RecognitionService')) {
  xml = xml.replace(
    '</manifest>',
    '    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n        <intent>\n            <action android:name="android.intent.action.TTS_SERVICE" />\n        </intent>\n    </queries>\n</manifest>',
  );
}
writeFileSync(path, xml);
console.log('AndroidManifest.xml pronto');

// Versão do app: VERSION_CODE (número inteiro que sobe a cada envio à Play Store)
// e VERSION_NAME (ex.: 1.0.3). No CI vêm do número da execução e do package.json.
const gradlePath = 'android/app/build.gradle';
let gradle = readFileSync(gradlePath, 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const code = process.env.VERSION_CODE;
const name = process.env.VERSION_NAME || pkg.version;
if (code) gradle = gradle.replace(/versionCode \d+/, `versionCode ${code}`);
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${name}"`);
writeFileSync(gradlePath, gradle);
console.log(`Versão ${name}${code ? ` (${code})` : ''}`);
