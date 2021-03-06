'use strict';

const Promise = require('promise');
const Long = require('cassandra-driver').types.Long;
const cassandraConnector = require('../../clients/cassandra/CassandraConnector');
const featureServiceClient = require('../../clients/locations/FeatureServiceClient');
const { tilesForBbox, withRunTime, getTermsByCategory, withCsvExporter, toConjunctionTopics, fromTopicListToConjunctionTopics } = require('../shared');
const { requiresRole } = require('../../auth');
const { makeSet, makeMap, aggregateBy } = require('../../utils/collections');
const { trackEvent } = require('../../clients/appinsights/AppInsightsClient');

const MaxFetchedRows = 1000;

function getPlaceBlacklist() {
  return new Promise((resolve, reject) => {
    const query = 'SELECT conjunctivefilter, islocation FROM fortis.blacklist';

    cassandraConnector.executeQuery(query, [])
      .then(rows => {
        const blacklistedPlaces = new Set();
        rows.filter(row => row.islocation).forEach(row => {
          if (row.conjunctivefilter.length > 1) {
            console.warn(`Got place blacklist entry ${row.id} with more than one term, this is not supported.`);
          }
          const blacklistedPlace = row.conjunctivefilter[0];
          blacklistedPlaces.add(blacklistedPlace && blacklistedPlace.toLowerCase());
        });
        resolve(blacklistedPlaces);
      }).catch(reject);
  });
}

function popularLocations(args, res) { // eslint-disable-line no-unused-vars
  return new Promise((resolve, reject) => {
    const fetchSize = 400;
    const responseSize = args.limit || 5;
    const layerfilters = ['country'];

    const tiles = tilesForBbox(args.bbox, args.zoomLevel).map(tile => tile.id);
    if (!tiles || !tiles.length) {
      return reject(`No tiles found for bounding box ${args.bbox.join(',')} and zoom ${args.zoomLevel}`);
    }

    const query = `
    SELECT mentioncount, placeid, mentioncount, avgsentimentnumerator
    FROM fortis.popularplaces
    WHERE periodtype = ?
    AND conjunctiontopic1 = ?
    AND conjunctiontopic2 = ?
    AND conjunctiontopic3 = ?
    AND pipelinekey IN ?
    AND externalsourceid = ?
    AND tilez = ?
    AND perioddate <= ?
    AND perioddate >= ?
    AND tileid IN ?
    LIMIT ?
    `.trim();

    const params = [
      args.periodType,
      ...toConjunctionTopics(args.maintopic, args.conjunctivetopics),
      args.pipelinekeys,
      args.externalsourceid,
      args.zoomLevel,
      args.toDate,
      args.fromDate,
      tiles,
      MaxFetchedRows
    ];

    return cassandraConnector.executeQuery(query, params, { fetchSize })
      .then(rows => {
        const placeIds = Array.from(makeSet(rows, row => row.placeid));

        if (!placeIds.length) {
          return resolve({ edges: []});
        }

        getPlaceBlacklist()
          .then((blacklistedPlaces) => {
            featureServiceClient.fetchById(placeIds, 'bbox,centroid')
              .then(features => {
                const placeIdToFeature = makeMap(features, feature => feature.id, feature => feature);

                const rawEdges = rows
                  .map(row => ({
                    name: placeIdToFeature[row.placeid].name,
                    mentioncount: row.mentioncount,
                    layer: placeIdToFeature[row.placeid].layer,
                    placeid: row.placeid,
                    avgsentimentnumerator: row.avgsentimentnumerator,
                    centroid: placeIdToFeature[row.placeid].centroid,
                    bbox: placeIdToFeature[row.placeid].bbox
                  }))
                  .filter(row => row.layer && layerfilters.indexOf(row.layer) === -1)
                  .filter(row => row.name && !blacklistedPlaces.has(row.name.toLowerCase()));

                const edges = aggregateBy(rawEdges, row => `${row.name.toLowerCase()}`, row => ({
                  name: row.name,
                  coordinates: row.coordinates,
                  centroid: row.centroid,
                  bbox: row.bbox,
                  placeid: row.placeid,
                  mentions: Long.ZERO,
                  layer: row.layer,
                  avgsentimentnumerator: Long.ZERO
                }))
                  .slice(0, responseSize);

                resolve({
                  edges
                });
              })
              .catch(reject);
          })
          .catch(reject);
      });
  });
}

function timeSeries(args, res) { // eslint-disable-line no-unused-vars
  return new Promise((resolve, reject) => {
    let conjunctivetopics = args.conjunctivetopics;
    let maintopics = args.maintopics;

    if (conjunctivetopics.length && maintopics.length) {
      const topics = toConjunctionTopics(args.maintopics[0], args.conjunctivetopics);
      maintopics = [topics[0]];
      conjunctivetopics = topics.slice(1);
    }

    const MaxConjunctiveTopicsAllowed = 2;

    const tiles = tilesForBbox(args.bbox, args.zoomLevel).map(tile => tile.id);
    if (!tiles || !tiles.length) {
      return reject(`No tiles found for bounding box ${args.bbox.join(',')} and zoom ${args.zoomLevel}`);
    }

    const query = `
    SELECT conjunctiontopic1, conjunctiontopic2, conjunctiontopic3, perioddate, mentioncount, avgsentimentnumerator, tileid
    FROM fortis.computedtiles
    WHERE periodtype = ?
    AND conjunctiontopic1 IN ?
    AND conjunctiontopic2 = ?
    AND conjunctiontopic3 = ?
    AND pipelinekey IN ?
    AND externalsourceid = ?
    AND tilez = ?
    AND perioddate <= ?
    AND perioddate >= ?
    AND tileid IN ?
    `.trim();

    const params = [
      args.periodType,
      maintopics,
      ...fromTopicListToConjunctionTopics(conjunctivetopics, MaxConjunctiveTopicsAllowed),
      args.pipelinekeys,
      args.externalsourceid,
      args.zoomLevel,
      args.toDate,
      args.fromDate,
      tiles
    ];

    return cassandraConnector.executeQuery(query, params)
      .then(rows => {
        const labels = Array.from(makeSet(rows, row => row.conjunctiontopic1.toLowerCase())).map(row => ({ name: row.toLowerCase() }));
        const tiles = Array.from(makeSet(rows, row => row.tileid)).map(row => row);
        const graphData = aggregateBy(rows, row => `${row.conjunctiontopic1.toLowerCase()}_${row.perioddate.getTime()}`, row => ({
          date: row.perioddate.getTime(),
          name: row.conjunctiontopic1.toLowerCase(),
          mentions: Long.ZERO,
          avgsentimentnumerator: Long.ZERO
        }));
        resolve({
          labels,
          graphData,
          tiles
        });
      })
      .catch(reject);
  });
}

function locations(args, res) { // eslint-disable-line no-unused-vars
  return new Promise((resolve, reject) => {
    const { bbox } = args;

    featureServiceClient.fetchByBbox({ north: bbox[0], west: bbox[1], south: bbox[2], east: bbox[3] }, 'bbox,centroid')
      .then(locations => {
        const places = locations.map(location => ({
          name: location.name,
          placeid: location.id,
          layer: location.layer,
          bbox: location.bbox,
          centroid: location.centroid
        }));
        resolve({
          places
        });
      })
      .catch(reject);
  });
}

function topTerms(args, res) { // eslint-disable-line no-unused-vars
  return new Promise((resolve, reject) => {
    const fetchSize = 400;
    const responseSize = args.limit || 5;

    getTermsByCategory(null, args.category)
      .then(terms => {

        if(!terms.edges.length){
          return resolve({edges: []});
        }

        const tiles = tilesForBbox(args.bbox, args.zoomLevel).map(tile => tile.id);
        if (!tiles || !tiles.length) {
          return reject(`No tiles found for bounding box ${args.bbox.join(',')} and zoom ${args.zoomLevel}`);
        }

        const query = `
          SELECT mentioncount, conjunctiontopic1, avgsentimentnumerator
          FROM fortis.populartopics
          WHERE periodtype = ?
          AND pipelinekey IN ?
          AND externalsourceid = ?
          AND tilez = ?
          AND perioddate <= ?
          AND perioddate >= ?
          AND tileid IN ?
          AND conjunctiontopic1 IN ?
          AND conjunctiontopic2 = ''
          AND conjunctiontopic3 = ''
          LIMIT ?
          `.trim();

        //todo: figure out why node driver timezone conversion is filtering out a majority of records
        const params = [
          args.periodType,
          args.pipelinekeys,
          args.externalsourceid,
          args.zoomLevel,
          args.toDate,
          args.fromDate,
          tiles,
          terms.edges.map(item => item.name),
          MaxFetchedRows
        ];

        return cassandraConnector.executeQuery(query, params, { fetchSize })
          .then(rows =>
            resolve({
              edges: aggregateBy(rows, row => `${row.conjunctiontopic1}`, row => ({
                name: row.conjunctiontopic1,
                mentions: Long.ZERO,
                avgsentimentnumerator: Long.ZERO
              })).slice(0, responseSize)
            })
          );
      })
      .catch(reject);
  });
}

function topSources(args, res) { // eslint-disable-line no-unused-vars
  return new Promise((resolve, reject) => {
    const fetchSize = 400;
    const responseSize = args.limit || 5;

    const tiles = tilesForBbox(args.bbox, args.zoomLevel).map(tile => tile.id);
    if (!tiles || !tiles.length) {
      return reject(`No tiles found for bounding box ${args.bbox.join(',')} and zoom ${args.zoomLevel}`);
    }

    const query = `
    SELECT mentioncount, pipelinekey, externalsourceid, avgsentimentnumerator
    FROM fortis.popularsources
    WHERE periodtype = ?
    AND conjunctiontopic1 = ?
    AND conjunctiontopic2 = ?
    AND conjunctiontopic3 = ?
    AND pipelinekey IN ?
    AND tilez = ?
    AND perioddate <= ?
    AND perioddate >= ?
    AND tileid IN ?
    LIMIT ?
    `.trim();

    const params = [
      args.periodType,
      ...toConjunctionTopics(args.maintopic, args.conjunctivetopics),
      args.pipelinekeys,
      args.zoomLevel,
      args.toDate,
      args.fromDate,
      tiles,
      MaxFetchedRows
    ];

    return cassandraConnector.executeQuery(query, params, { fetchSize })
      .then(rows => {
        const filteredRows = rows.filter(row => row.pipelinekey !== 'all' && row.externalsourceid !== 'all');//filter all aggregates as we're interested in named sources only
        const edges = aggregateBy(filteredRows, row => `${row.pipelinekey}_${row.externalsourceid}`, row => ({
          pipelinekey: row.pipelinekey,
          name: row.externalsourceid,
          mentions: Long.ZERO,
          avgsentimentnumerator: Long.ZERO
        }))
          .slice(0, responseSize);

        resolve({
          edges
        });
      })
      .catch(reject);
  });
}

function conjunctiveTopics(args, res) { // eslint-disable-line no-unused-vars
  return new Promise((resolve, reject) => {
    const fetchSize = 400;
    const CassandraLimit = 1000;
    const MaxSize = 50;

    const tiles = tilesForBbox(args.bbox, args.zoomLevel).map(tile => tile.id);
    if (!tiles || !tiles.length) {
      return reject(`No tiles found for bounding box ${args.bbox.join(',')} and zoom ${args.zoomLevel}`);
    }

    const query = `
    SELECT mentioncount, conjunctivetopic, topic
    FROM fortis.conjunctivetopics
    WHERE periodtype = ?
    AND topic = ?
    AND tilez = ?
    AND pipelinekey IN ?
    AND externalsourceid = ?
    AND perioddate <= ?
    AND perioddate >= ?
    AND tileid IN ?
    LIMIT ?
    `.trim();

    const params = [
      args.periodType,
      args.maintopic,
      args.zoomLevel,
      args.pipelinekeys,
      args.externalsourceid,
      args.toDate,
      args.fromDate,
      tiles,
      CassandraLimit
    ];

    return cassandraConnector.executeQuery(query, params, { fetchSize })
      .then(rows => {
        const filteredRows = rows.filter(topic => topic.conjunctivetopic.toLowerCase() !== args.maintopic.toLowerCase());
        //todo: need to add sentiment field to the conjunctivetopics table
        const edges = aggregateBy(filteredRows, row => `${row.conjunctivetopic}`, row => ({
          conjunctionterm: row.conjunctivetopic,
          name: row.topic,
          mentions: Long.ZERO
        })).slice(0, MaxSize);

        resolve({
          edges
        });
      })
      .catch(reject);
  });
}

module.exports = {
  popularLocations: requiresRole(trackEvent(withRunTime(withCsvExporter(popularLocations, 'edges')), 'popularLocations'), 'user'),
  timeSeries: requiresRole(trackEvent(withCsvExporter(timeSeries, 'graphData'), 'timeSeries'), 'user'),
  topTerms: requiresRole(trackEvent(withCsvExporter(topTerms, 'edges'), 'topTerms'), 'user'),
  geofenceplaces: requiresRole(trackEvent(withRunTime(withCsvExporter(locations, 'places')), 'locations'), 'user'),
  conjunctiveTopics: requiresRole(trackEvent(withCsvExporter(conjunctiveTopics, 'edges'), 'conjunctiveTopics'), 'user'),
  topSources: requiresRole(trackEvent(withCsvExporter(topSources, 'edges'), 'topSources'), 'user')
};