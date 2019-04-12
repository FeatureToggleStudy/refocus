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
const featureToggles = require('feature-toggles');
const urlParser = require('url');
const kue = require('kue');
const Promise = require('bluebird');
const activityLogUtil = require('../utils/activityLog');
const BullQueue = require('bull');

const redisOptions = {
  redis: conf.redis.instanceUrl.queue,
};

let redisUrl = redisOptions.redis;

const redisInfo = urlParser.parse(redisOptions.redis, true);
if (redisInfo.protocol !== PROTOCOL_PREFIX) {
  redisOptions.redis = 'redis:' + redisOptions.redis;
  redisUrl = 'redis:' + redisUrl;
}

const jobQueue = kue.createQueue(redisOptions);

console.log('bulkUpsertQueue initialized with redis', redisUrl);
const bulkUpsertQueue = new BullQueue('sample upserts', redisUrl);

function resetJobQueue() {
  return Promise.map(jobQueue.workers, (w) =>
    new Promise((resolve) => w.shutdown(resolve))
  )
  .then(() => jobQueue.workers = []);
}

/**
 * Kue's Queue graceful shutdown.
 */
function gracefulShutdown() {
  const start = Date.now();
  jobQueue.shutdown(conf.kueShutdownTimeout, (err) => {
    if (featureToggles.isFeatureEnabled('enableSigtermActivityLog')) {
      const status = '"Job queue shutdown: ' + (err || 'OK') + '"';
      const logWrapper = {
        status,
        totalTime: `${Date.now() - start}ms`,
      };
      activityLogUtil.printActivityLogString(logWrapper, 'sigterm');
    }
  });
}

jobQueue.on('error', (err) => {
  console.error('Kue Error!', err); // eslint-disable-line no-console
});

if (featureToggles.isFeatureEnabled('instrumentKue')) {
  jobQueue.on('job enqueue', (id, type) => {
    console.log('[KJI] enqueued: ' + // eslint-disable-line no-console
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
  bulkUpsertQueue,
}; // exports
