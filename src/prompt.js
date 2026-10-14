export function ask(question, { command }) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error(`Run this in an interactive terminal: docker exec -it ucweb npm run ${command}`));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let answer = '';
    const onData = (text) => {
      for (const char of text) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(answer);
          return;
        }
        if (char === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1);
        else answer += char;
      }
    };
    stdin.on('data', onData);
  });
}
