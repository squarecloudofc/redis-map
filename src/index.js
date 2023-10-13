// Created with ❤️ by @joaootavios to @squarecloudofc
const redis = require("redis");

const Action = {
    SET: 1,
    DELETE: 2,
    CLEAR: 3
};

class RedisAPI {

    #redis;
    #pubsub;
    #monitor;

    /**
     * Initialize the RedisMap class.
     * @param {Object} options Options.
     * @param {String} options.url Redis url.
     * @param {Function} options.monitor Callback function. Args: (type = "state / error", message = string).
     * @param {Object} options.redisOptions Redis options. (Default: {}).
     */
    constructor(options) {

        const url = options?.url;

        if (!url || !url.match(/redis:\/\//g)) {
            throw new Error("[redis-map] Invalid redis url!");
        };

        this.#redis = redis.createClient({ url, ...options?.redisOptions });
        this.#pubsub = this.#redis.duplicate();
        this.#monitor = options?.monitor;

        this.#redis.on("connect", () => this.#log("state", "[redis-map] Redis client connected!"));
        this.#pubsub.on("connect", () => this.#log("state", "[redis-map] Redis pubsub connected!"));

        this.#redis.on("error", (err) => this.#log("error", `[redis-map] Redis error: ${err}`));
        this.#pubsub.on("error", (err) => this.#log("error", `[redis-map] Redis pubsub error: ${err}`));

    }

    /**
     * Connect to Redis.
     * @returns {Object} Redis connection information.
     */
    async connect() {

        if (this.#pubsub.isOpen && this.#redis.isOpen) return;
        await Promise.all([this.#redis.connect(), this.#pubsub.connect()]);

        // Enable expired events for keyspace notifications in all maps.
        this.#pubsub.configSet("notify-keyspace-events", "Ex");

        return {
            redis: this.#redis,
            pubsub: this.#pubsub,
            disconnect: this.disconnect.bind(this)
        }
    }

    /**
     * Disconnect from Redis.
     */
    async disconnect() {
        if (!this.#pubsub.isOpen && !this.#redis.isOpen) return;
        await Promise.all([
            this.#redis.quit(),
            this.#pubsub.quit()
        ]);
    }

    /**
     * Log a message.
     * @param {String} type Log type.
     * @param {String} message Log message.
     */
    #log(type, message) {
        if (this.#monitor) this.#monitor(type, message);
    }

}

class RedisMap {
    #redis;
    #pubsub;
    #options;

    /**
     * Initialize the RedisMap class.
     * @param {Object} options Options.
     * @param {String} options.name Name of the map. (Default: redis-map).
     * @param {Boolean} options.sync Sync data from redis on init. (Default: true).
     * @param {Function} options.monitor Callback function. Args: (type = "state / info / error", message = string, name = name of the map).
     */
    constructor(options) {

        this.name = options?.name || "redis-map";
        this.#options = options;
        this.data = {};

        this.#redis = options?.connections?.redis;
        this.#pubsub = options?.connections?.pubsub;

        if (!(this.#redis.isOpen || this.#pubsub.isOpen)) {
            throw new Error("[redis-map] Redis client is not connected!");
        };

        if (this.#options?.sync !== false) this.sync();
        this.#subscribe();
    }

    get(key) {
        return this.data[key] || null;
    }

    has(key) {
        return key in this.data;
    }

    entries() {
        return Object.entries(this.data);
    }

    /**
     * Set a value to the map in local cache and redis.
     * @param {String} key Key
     * @param {*} value Value
     * @param {Number} expire Expire key in seconds.
     */
    async set(key, value, expire) {
        this.data[key] = value;

        const pipeline = this.#redis.multi();

        pipeline.set(this.name, JSON.stringify(value));
        pipeline.publish(this.name, JSON.stringify({ a: Action.SET, key, value }));

        if (expire) {
            pipeline.set(`rmap-${this.name}-ex=${key}`, 0, { EX: expire });
        }

        await pipeline.exec();
    }

    /**
     * Delete a value from the map in local cache and redis.
     * @param {String} key
     */
    async delete(key) {
        delete this.data[key];

        const pipeline = this.#redis.multi();

        pipeline.set(this.name, JSON.stringify(this.data));
        pipeline.publish(this.name, JSON.stringify({ a: Action.DELETE, key }));

        await pipeline.exec();
    }

    /**
     * WARNING: This method will clear all data from the map in local cache and redis.
     */
    async clear() {
        const pipeline = this.#redis.multi();

        pipeline.del(this.name);
        pipeline.publish(this.name, JSON.stringify({ a: Action.CLEAR }));

        await pipeline.exec();
    }

    async sync() {
        const data = await this.#redis.get(this.name).catch(() => null);

        if (data) {
            this.data = JSON.parse(data);
            this.#log("info", `[${this.name}] Redis data synced!`);
        } else {
            this.#log("info", `[${this.name}] No data found on redis to sync!`);
        }
    }

    #log(type, message) {
        if (this.#options?.monitor) this.#options.monitor(type, message, this.name);
    }

    #subscribe() {

        this.#pubsub.pSubscribe("__keyevent@0__:expired", (data) => {
            if (data.startsWith(`rmap-${this.name}-ex`)) {
                delete this.data[data.split("=")[1]];
            }
        });

        this.#pubsub.subscribe(this.name, (message) => {
            const { a: action, key, value } = JSON.parse(message);

            this.#log("info", { action, key, value });

            switch (action) {
                case Action.SET:
                    this.data[key] = value;
                    break;
                case Action.DELETE:
                    delete this.data[key];
                    break;
                case Action.CLEAR:
                    this.data = {};
                    break;
            }
        });
    }

}

module.exports = {
    RedisAPI,
    RedisMap
};
