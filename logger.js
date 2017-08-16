'use strict';

const winston = require('winston')
const config = require('config');
const moment = require('moment')

module.exports = (module, filename) => {
    filename = filename || 'info.log'
    return makeLogger(module, filename)
}

function makeLogger(module, filename) {

    const path = module.filename.split('/').slice(-2).join('/')

    let transports = [

        new winston.transports.File({
            timestamp: function () { return moment().format()},
            filename: 'log/' + filename,
            level: 'debug',
            label: path,
            json: false,
            maxFiles: 5,
            maxsize: 100000000,
        }),
    ]

    if (config.app.debug){
        transports.push(new winston.transports.Console())
    }
    return new winston.Logger({transports: transports})
}