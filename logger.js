const fs = require("fs");
const path = require("path");

const logFile = path.join(__dirname, "bot.log");

function log(message, type = "INFO") {
  const time = new Date().toLocaleString("pt-BR");

  const colors = {
    INFO: "\x1b[36m",     // azul
    SUCCESS: "\x1b[32m",  // verde
    WARN: "\x1b[33m",     // amarelo
    ERROR: "\x1b[31m",    // vermelho
    EVENT: "\x1b[35m"     // roxo
  };

  const reset = "\x1b[0m";

  const line = `[${time}] [${type}] ${message}`;

  console.log(`${colors[type] || ""}${line}${reset}`);

  fs.appendFileSync(logFile, line + "\n");
}

module.exports = log;