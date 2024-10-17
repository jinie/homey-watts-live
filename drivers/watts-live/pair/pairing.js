'use strict';

module.exports.init = function () {
  // Handle the MQTT method selection event
  Homey.on('choose_mqtt_method', function (data, callback) {
    console.log('Received MQTT settings:', data);

    // Emit the data to the driver
    Homey.emit('choose_mqtt_method', data, function (err) {
      if (err) {
        console.error('Error emitting choose_mqtt_method:', err);
        return callback(err);
      }
      // Proceed to loading.html after emitting the settings
      Homey.nextView('loading');
    });
  });

  // Start the device discovery process
  Homey.on('start_discovery', function (data, callback) {
    console.log('Starting device discovery...');

    // Emit the event to initiate discovery in the driver
    Homey.emit('start_discovery', {}, function (err, result) {
      if (err) {
        console.error('Error starting discovery:', err);
        return callback(err);
      }
      // Proceed to the list_devices view after discovery starts
      console.log('Discovery started, proceeding to list_devices');
      Homey.nextView('list_devices');
    });
  });

  // Fetch the discovered devices from the driver
  Homey.on('list_devices', function (data, callback) {
    console.log('Requesting discovered devices from driver...');

    // Call the API to retrieve the devices
    Homey.api('get_devices', {}, function (err, devices) {
      if (err) {
        console.error('Error fetching devices:', err);
        return callback(err);
      }

      console.log('Devices fetched:', devices);
      callback(null, devices);  // Return the list of devices to the frontend
    });
  });

  // Handle adding the selected device
  Homey.on('add_device', function (device, callback) {
    console.log('Adding device:', device);

    // Emit the event to add the selected device to Homey
    Homey.emit('add_device', device, function (err, result) {
      if (err) {
        console.error('Error adding device:', err);
        return callback(err);
      }
      console.log('Device successfully added:', result);
      callback(null, result);  // Confirm the device was added successfully
    });
  });
};
