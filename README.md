## Information
A simple way to use something similar to the Map in javascript, but synchronized with the power of Redis.

## Install
```
npm install @squarecloudofc/redis-map
```

## Example of usage
```javascript
const { RedisAPI, RedisMap } = require("@squarecloudofc/redis-map");

(async () => {
    
    const connections = await new RedisAPI({
        url: process.env.REDIS, 
        monitor: (type, message) => {
            console.log(`[REDIS] ${type}: ${message}`);
        }
    }).connect();

    // Example using same connection (for two maps);

    // first map;
    const cacheUsers = new RedisMap({
        connections,
        name: "example:cache:users", 
        monitor: (type, message, name) => {
            console.log(name, type, message);
        }
    });

    // second map;
    const cacheApps = new RedisMap({
        connections,
        name: "example:cache:apps",
        sync: false // disable sync with redis;
    });

    await cacheUsers.set("joao", { plan: "free", balance: 1000 });
    console.log(cacheUsers.get("joao"), "\n");

    await cacheApps.set("water_man", { protection: 10, shield: 50 });
    console.log(cacheApps.get("water_man"), "\n");

    connections.disconnect();

})();
```

## LICENSE
This project is licensed under the Apache License 2.0.

Sponsored by [Square Cloud](https://squarecloud.app/).