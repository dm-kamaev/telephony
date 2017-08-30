const schedule = require('node-schedule');
const { query, queryOne, backgroundQuery } = require('./db')
const logicLog = require('./logger')(module, 'logic.log')
const errorLog = require('./logger')(module, 'error.log')

const CRON_CLOSE_CHANNEL = 1
// MAX TIME LIFE CHANNEL MINUTE
const MINUTE = 120

async function closeHoverChannel(appInterface){
    try {
        async function closeChannel(channel_id, reason, closingTime=null) {
            closingTime = closingTime || new Date()
            let channel = appInterface.channelCollection.idDict[channel_id]
            if (channel){
                await channel.close(reason, closingTime)
                logicLog.info(`SCHEDULER - CLOSE channel ${channel} reason ${reason.txt} `)
            } else {
                let setEndChannelSQL = `UPDATE channels SET "end" = $1, reason_h=$2, reason_h_code=$3 ` +
                        `WHERE id=$4`
                await query(setEndChannelSQL, [closingTime, reason.txt, reason.code, channel_id])
                logicLog.info(`SCHEDULER - SET END channel ${channel_id} reason ${reason.txt}`)
            }
        }

        async function getBadItemId(collection, minute=MINUTE) {
            const getBadIDSQL = "SELECT id " +
                `FROM ${collection} ` +
                "WHERE " +
                    `"end" IS NULL AND ` +
                    `(begin + INTERVAL '${minute} MINUTE') < NOW()`
            let rows = await query(getBadIDSQL)
            let idList = []
            for (let row of rows){
                idList.push(row.id)
            }
            return idList
        }

        let badChannel = false
        let badBridge = false
        let badBridgeChannels = false
        const checkAllSQL =
                "SELECT DISTINCT 'bridge' as result " +
                    "FROM bridges " +
                    `WHERE "end" IS null AND (INTERVAL '${MINUTE} minutes' + begin) < NOW() ` +
                "UNION " +
                    "(SELECT DISTINCT 'channel' as result " +
                    "FROM channels " +
                    `WHERE "end" IS null AND (INTERVAL '${MINUTE} minutes' + begin) < NOW()) ` +
                "UNION " +
                    "(SELECT DISTINCT 'bridge_channels' as result " +
                    "FROM bridges_channels " +
                    `WHERE "end" IS null AND (INTERVAL '${MINUTE} minutes' + begin) < NOW())`
        let rows = await query(checkAllSQL)
        for (let row of rows){
            if (row.result == 'bridge'){
                badBridge = true
            } else if (row.result == 'channel'){
                badChannel = true
            } else if (row.result == 'bridge_channels'){
                badBridgeChannels = true
            }
        }
        if (badChannel){
            let badChannelId = await getBadItemId('channels')
            let tempData = []
            for (let i=1; i <= badChannelId.length; i++){tempData.push(`$${i}`)}
            let arraySQL = '(' + tempData.join(',') + ')'
            let getEndBridgesBadChannelsSQL = 'SELECT channel_id, "end" ' +
                                "FROM bridges_channels " +
                                "WHERE id IN  (SELECT MAX(id) " +
                                    "FROM bridges_channels " +
                                    `WHERE channel_id IN ${arraySQL} ` +
                                    "GROUP BY channel_id) " +
                                `AND "end" IS NOT NULL;`
            let endByBridgeRows = await query(getEndBridgesBadChannelsSQL, badChannelId)
            if (endByBridgeRows){
                let reason = {'txt': 'Scheduler close channel, based on bridge_channels', 'code': '-12'}
                for (let row of endByBridgeRows){
                    await closeChannel(row.channel_id, reason, row.end)
                    badChannelId.splice(badChannelId.indexOf(row.channel_id), 1)
                }
            }
            let reason = {'txt': 'Scheduler close channel, current moment', 'code': '-13'}
            for (let badId of badChannelId){
                closeChannel(badId, reason)
            }
        }
        if (badBridgeChannels){
            let badBridgeChannelId = await getBadItemId('bridges_channels')
            let tempData = []
            for (let i=1; i <= badBridgeChannelId.length; i++){tempData.push(`$${i}`)}
            let arraySQL = '(' + tempData.join(',') + ')'
            let updateBridgeChannelSQL =  'UPDATE bridges_channels AS bc ' +
                                        'SET "end" = ch."end" ' +
                                        'FROM channels as ch ' +
                                        'WHERE ' +
                                          'bc.channel_id = ch.id AND ' +
                                          ' bc.id IN (SELECT id_bridge_channels.bc_id ' +
                                                          'FROM (SELECT MAX(id) AS bc_id ' +
                                                                    'FROM bridges_channels ' +
                                                                    'WHERE channel_id IN ( ' +
                                                                      'SELECT channel_id ' +
                                                                      'FROM bridges_channels ' +
                                                                      `WHERE id IN ${arraySQL} AND ` +
                                                                      "(INTERVAL '1206 HOURS' + begin) > NOW()) " +
                                                                    'GROUP BY channel_id ' +
                                                                ') AS id_bridge_channels' +
                                          ') AND ' +
                                          `bc.id IN ${arraySQL}  AND ` +
                                          'ch."end" is NOT NULL AND ' +
                                          "ch.reason_h_code != '-13'";
            await query(updateBridgeChannelSQL, badBridgeChannelId)
        }
    } catch (e){
        errorLog.info(e)
    }
}

module.exports = (appInterface) => {
    schedule.scheduleJob(`*/${CRON_CLOSE_CHANNEL} * * * *`, async ()=>{await closeHoverChannel(appInterface)})
}