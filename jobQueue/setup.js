/**
 * Copyright (c) 2016, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or
 * https://opensource.org/licenses/BSD-3-Clause
 */

/**
 * /jobQueue/setup.js
 *
 * Setup the "Kue" library to process background jobs. Declare all job types to
 * be processed by the workers in the jobType object.
 */
'use strict'; // eslint-disable-line strict
const PROTOCOL_PREFIX = 'redis:';
const conf = require('../config');
const logger = require('@salesforce/refocus-logging-client');
const featureToggles = require('feature-toggles');
const urlParser = require('url');
const kue = require('kue');
const BullQueue = require('bull');
const Promise = require('bluebird');
const activityLogUtil = require('../utils/activityLog');

const redisOptions = {
  redis: conf.redis.instanceUrl.queue,
};

let redisUrlForBull = redisOptions.redis;

const redisInfo = urlParser.parse(redisOptions.redis, true);
if (redisInfo.protocol !== PROTOCOL_PREFIX) {
  redisOptions.redis = 'redis:' + redisOptions.redis;
  redisUrlForBull = 'redis:' + redisUrlForBull;
}

const jobQueue = kue.createQueue(redisOptions);
const bulkDelSubQueue = new BullQueue(
  conf.jobType.bulkDeleteSubjects, redisUrlForBull);
const bulkPostEventsQueue = new BullQueue(
  conf.jobType.bulkPostEvents, redisUrlForBull);
const createAuditEventsQueue = new BullQueue(
  conf.jobType.createAuditEvents, redisUrlForBull);

function resetJobQueue() {
  return Promise.map(jobQueue.workers, (w) =>
    new Promise((resolve) => w.shutdown(resolve))
  )
  .then(() => jobQueue.workers = [])
    .then(() => bulkDelSubQueue.empty())
    .then(() => createAuditEventsQueue.empty())
    .then(() => bulkPostEventsQueue.empty());
}

/**
 * Kue's Queue graceful shutdown.
 */
function gracefulShutdown() {
  const start = Date.now();
  function printLog(status) {
    const logWrapper = {
      status,
      totalTime: `${Date.now() - start}ms`,
    };
    activityLogUtil.printActivityLogString(logWrapper, 'sigterm');
  }

  bulkDelSubQueue.close()
    .then(() => bulkPostEventsQueue.close())
    .then(() => createAuditEventsQueue.close())
    .then(() => {
      if (featureToggles.isFeatureEnabled('enableSigtermActivityLog')) {
        const status = '"Bull Job queue shutdown: OK"';
        printLog(status);
      }

      return jobQueue.shutdown(conf.kueShutdownTimeout, (err) => {
        if (featureToggles.isFeatureEnabled('enableSigtermActivityLog')) {
          const status = '"Kue Job queue shutdown: ' + (err || 'OK') + '"';
          printLog(status);
        }
      });
    })
    .catch((err) => {
      if (featureToggles.isFeatureEnabled('enableSigtermActivityLog')) {
        const status = '"Kue Job queue shutdown: ' + err + '"';
        printLog(status);
      }
    });
}

jobQueue.on('error', (err) => {
  logger.error('Kue Error!', err);
});

if (featureToggles.isFeatureEnabled('instrumentKue')) {
  jobQueue.on('job enqueue', (id, type) => {
    logger.info('[KJI] enqueued: ' +
      'id=%s type=%s', id, type);
  });
}

module.exports = {
  jobType: conf.jobType,
  jobQueue,
  resetJobQueue,
  gracefulShutdown,
  ttlForJobsAsync: conf.JOB_QUEUE_TTL_SECONDS_ASYNC,
  ttlForJobsSync: conf.JOB_QUEUE_TTL_SECONDS_SYNC,
  delayToRemoveJobs: conf.JOB_REMOVAL_DELAY_SECONDS,
  kue,
  bulkDelSubQueue,
  bulkPostEventsQueue,
  createAuditEventsQueue,
}; // exports
