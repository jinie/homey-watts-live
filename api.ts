'use strict';

module.exports = {
  // Used by the app settings page
  async getBuiltinBrokerStatus({ homey }: { homey: any }) {
    return homey.app.getBuiltinBrokerStatus();
  },
};
