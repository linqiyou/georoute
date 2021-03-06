'use strict';

const express = require('express');
const uuid = require('node-uuid');
const HttpStatus = require('http-status-codes');

const router = express.Router();

const Executor = require('../models/executor');
const Ip2Location = require('../models/ip2location');
const Terminator = require('../models/terminator');
const Cache = require('../models/cache');
const Logger = require('../util/logger');

router.post('/', (req, res, next) => {
    Logger.info(`trace domain name ${req.body.domainName} received`);

    if (req.session.guid) {
        const previousPid = Cache.get(req.session.guid);
        if (previousPid) {
            Terminator.terminate(previousPid);
            Cache.delete(req.session.guid);
        }
    }

    const guid = uuid.v4();
    req.session.guid = guid;
    res.status(HttpStatus.OK).send({ guid: guid });

    const socketNamespace = req.app.io.of('/' + guid);
    socketNamespace.on('connection', (socket) => {
        Logger.info(`a user from ${socket.conn.remoteAddress} connected`);

        let pidHolder = null;
        const executor = new Executor(new Ip2Location());
        executor
            .on('pid', (pid) => {
                pidHolder = pid;
                Cache.set(guid, pid);
            })
            .on('destination', (destination) => {
                socketNamespace.emit('destination', destination);
            })
            .on('data', (data) => {
                socketNamespace.emit('data', data);
            })
            .on('close', (code) => {
                if (code) {
                    socketNamespace.emit('terminated');
                }
                else {
                    socketNamespace.emit('close');
                }
            });

        socket.on('disconnect', () => {
            Logger.info(`a user from ${socket.conn.remoteAddress} disconnected`);

            if (pidHolder) {
                Terminator.terminate(pidHolder);
                Cache.delete(guid);
            }
        });

        executor.start(req.body.domainName);
    });

});

module.exports = router;