module.exports = {
  launch: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  server: {
    command: 'npm start',
    port: 3000,
    launchTimeout: 30000,
    debug: true,
  },
};
