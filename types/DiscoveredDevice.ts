'use strict';

export default interface DiscoveredDevice {
  id: string;
  name: string;
  data: {
    id: string;
  };
  settings: {
    deviceId: string;
  };
}
