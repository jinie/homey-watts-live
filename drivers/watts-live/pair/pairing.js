'use strict';

module.exports.init = function() {
  let selectedMqttMethod = null;
  let mqttSettings = null;
  let availableDevices = [];

  // Handle the event when the user selects an MQTT method
  Homey.on('choose_mqtt_method', function(data, callback) {
    selectedMqttMethod = data.mqttMethod; // Capture the MQTT method chosen by the user

    if (selectedMqttMethod === 'custom') {
      // Gather custom MQTT settings
      mqttSettings = {
        hostname: data.hostname,
        port: data.port,
        clientId: data.clientId,
        username: data.username,
        password: data.password,
        useTls: data.useTls
      };
    } else {
      // If Homey MQTT Client is selected, set the appropriate flag
      mqttSettings = {
        useHomeyMqttClient: true
      };
    }

    // Scan for devices based on the chosen MQTT settings
    Homey.api('choose_mqtt_method', { mqttSettings: mqttSettings }, function(err, response) {
      if (err) return callback(err);
      availableDevices = response.devices; // Get the devices available for pairing
      callback(null, true); // Proceed to the next step
    });
  });

  // Handle the list_devices step
  Homey.on('list_devices', function(data, callback) {
    callback(null, availableDevices);
  });

  // Store the selected devices
  Homey.on('store_settings', function(data, callback) {
    const selectedDevices = data.selectedDevices;
    Homey.api('store_settings', { selectedDevices: selectedDevices, mqttSettings: mqttSettings }, function(err) {
      if (err) return callback(err);
      callback(null, true);
    });
  });
};
