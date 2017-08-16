'use strict';

function asyncCommand(cmd){
    return new Promise((resolve, reject)=>{
        this.command(cmd, function () {
            resolve(arguments)
        })
    })
}

module.exports = function (agi) {
    agi.asyncCommand = asyncCommand.bind(agi)
}