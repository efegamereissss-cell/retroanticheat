const server = require('../server.js');

module.exports = (req, res) => {
    return server.emit('request', req, res);
};
