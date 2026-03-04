'use strict';

export default interface MessagesCollected {
    [topic: string]: {
        messages: string[];
    };
};
