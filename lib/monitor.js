var BpmnViewer = require('bpmn-js/lib/NavigatedViewer');

var Emitter = require('events');

var moment = require('moment');
var inherits = require('inherits');
var domify = require('domify');

var Api = require('./api');


function Monitor($el, engineUrl) {

  Emitter.call(this);


  var api = new Api(engineUrl);

  var viewer = new BpmnViewer($el);

  var error = function(message, err) {
    this.emit('error', message, err);

    return err;
  }.bind(this);


  var processDefinition = null;

  var topicDefinitions = null;


  function addExternalTaskOverlay(activityId) {

    var overlays = viewer.get('overlays'),
        canvas = viewer.get('canvas'),
        elementRegistry = viewer.get('elementRegistry');

    var shape = elementRegistry.get(activityId);

    var $overlayHtml = domify('<div class="highlight">');
    $overlayHtml.style.width = (shape.width + 10) + 'px';
    $overlayHtml.style.height = (shape.height + 10) + 'px';

    overlays.add(activityId, {
      position: {
        top: -5,
        left: -5
      },
      html: $overlayHtml
    });

    // add marker
    canvas.addMarker(activityId, 'external-task');
  }


  function updateMetrics(activityId, topicName, metrics) {

    var isDead = moment(metrics.lastPoll).isBefore(moment().subtract(15, 'seconds'));

    var canvas = viewer.get('canvas');

    if (isDead) {
      canvas.addMarker(activityId, 'dead');
      canvas.removeMarker(activityId, 'alive');
    } else {
      canvas.removeMarker(activityId, 'dead');
      canvas.addMarker(activityId, 'alive');
    }
  }


  var cachedOverlays = [];

  function updateStatistics(statistics) {

    var overlays = viewer.get('overlays');

    cachedOverlays.forEach(function(definition) {
      overlays.remove({ element: definition.activityId, type: definition.type });
    });

    cachedOverlays = [];

    statistics.forEach(function(entry) {

      var activityId = entry.id,
          instances = entry.instances;

      overlays.add(activityId, 'instances', {
        position: {
          bottom: 10,
          left: -20
        },
        html: domify('<div class="ui label"><i class="cubes icon"></i>' + instances + '</div>')
      });

      cachedOverlays.push({ activityId: activityId, type: 'instances' });


      if (entry.incidents.length) {

        // warning sign icon
        overlays.add(activityId, 'incidents', {
          position: {
            bottom: 10,
            right: 20
          },
          html: domify('<div class="ui red icon label"><i class="warning sign icon"></i></div>')
        });

        cachedOverlays.push({ activityId: activityId, type: 'incidents' });
      }
    });

  }


  function setDefinition(newDefinition) {

    processDefinition = newDefinition;

    if (!newDefinition) {
      return;
    }

    var processDefinitionId = processDefinition.id;

    api.getBpmnXML(processDefinitionId, function(err, xml) {

      if (err) {
        return error('failed to fetch BPMN 2.0 XML for process', err);
      }

      viewer.importXML(xml, function(err) {
        if (err) {
          return error('failed to render process', err);
        }

        api.getTopicDefinitions(processDefinitionId, function(err, topicDefinitions) {

          if (err) {
            return error('failed to fetch topics', err);
          }

          topicDefinitions.forEach(function(topicDefinition) {
            addExternalTaskOverlay(topicDefinition.activityId);
          });

          refresh(topicDefinitions);
        });

      });

    });
  }

  /**
   * Show monitor for process definition id.
   *
   * @param {String} id
   */
  this.show = function(id, callback) {

    api.getProcessDefinitions(id, function(err, definitions) {

      if (err) {
        return callback(err);
      }

      setDefinition(definitions[0]);

      callback(null, definitions);
    });
  };

  function refresh(newDefinitions, callback) {

    if (typeof newDefinitions === 'function') {
      callback = newDefinitions;
      newDefinitions = undefined;
    }

    if (newDefinitions) {
      topicDefinitions = newDefinitions;
    }


    if (!topicDefinitions) {

      if (callback) {
        callback(err);
      }

      return;
    }


    var topicIds = topicDefinitions.map(function(def) { return def.topicName; });

    api.getMetrics(topicIds, function(err, metrics) {

      if (err) {
        return error('failed to fetch metrics', err);
      }

      topicDefinitions.forEach(function(def) {

        var metric = metrics[def.topicName];

        if (metric) {
          updateMetrics(def.activityId, def.topicName, metric);
        }
      });

    });

    api.getStatistics(processDefinition.id, function(err, statistics) {

      if (err) {
        return error('failed to fetch statistics', err);
      }

      updateStatistics(statistics);
    });
  }

  this.refresh = refresh;

  // refresh periodically
  // setInterval(refresh, 1500);
}


inherits(Monitor, Emitter);


module.exports = Monitor;