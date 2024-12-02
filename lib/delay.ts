'use strict';

export default function delay(t: number, val:any): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, t, val));
}
