const express = require('express');
const validator = require('validator');
const HttpStatus = require('http-status-codes');

const router = express.Router();

const Executor = require('../models/executor');
const Ip2Location = require('../models/ip2location');
const Terminator = require('../models/terminator');

router.post('/', (req, res, next) => {
    console.log(`trace domain name ${req.body.domainName} received`);

    if (!validator.isFQDN(req.body.domainName) && !validator.isIP(req.body.domainName)) {
        console.log(`trace not a valid domain name or ip received, returning http ${HttpStatus.BAD_REQUEST}`);

        res.sendStatus(HttpStatus.BAD_REQUEST);
        return;
    }

    if (req.session.pid !== undefined) {
        Terminator.terminate(req.session.pid);
    }

    let socketNamespace = null;
    let isSocketConnected = false;
    const dataQueue = [];
    let destinationHolder = null;

    const executor = new Executor(new Ip2Location());
    executor
        .on('pid', (pid) => {
            req.session.pid = pid;
            if (pid !== undefined) {
                socketNamespace = req.app.io.of('/' + pid);

                socketNamespace.on('connection', (socket) => {
                    console.log(`a user from ${socket.conn.remoteAddress} connected`);

                    isSocketConnected = true;
                    socket.on('disconnect', () => {
                        console.log(`a user from ${socket.conn.remoteAddress} disconnected`);

                        Terminator.terminate(pid);
                    });
                });

                console.log(`trace process with id ${pid} created, returning http ${HttpStatus.OK}`);

                res.status(HttpStatus.OK).send({ pid: pid });
            }
            else {
                console.log(`trace process not created, returning http ${HttpStatus.INTERNAL_SERVER_ERROR}`);

                res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
            }
        })
        .on('destination', (destination) => {
            destinationHolder = destination;
        })
        .on('data', (data) => {
            dataQueue.push(data);

            if (isSocketConnected) {
                while (dataQueue.length) {
                    socketNamespace.emit('data', dataQueue.shift());
                }
            }
        })
        .on('done', (code) => {
            socketNamespace.emit('destination', destinationHolder);
            socketNamespace.emit('done');
        });

    executor.start(req.body.domainName);
});

module.exports = router;