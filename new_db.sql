CREATE TABLE IF NOT EXISTS channels (
    id serial PRIMARY KEY,
    channel_name VARCHAR(150),
    unique_id VARCHAR(150),
    number VARCHAR(150),
    originate_key VARCHAR(150),
    trunk_id INTEGER DEFAULT NULL,
    incoming BOOLEAN,
    "begin" TIMESTAMP,
    begin_ringing TIMESTAMP,
    begin_talk TIMESTAMP,
    "end" TIMESTAMP,
    reason_h VARCHAR(150),
    reason_h_code INTEGER
);

CREATE TABLE IF NOT EXISTS extensions (
    id serial PRIMARY KEY,
    default_trunk_id INTEGER DEFAULT NULL,
    extension VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS bridges (
    id serial PRIMARY KEY,
    "begin" TIMESTAMP,
    "end" TIMESTAMP,
    bridgeuniqueid VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS bridges_channels (

    id serial PRIMARY KEY,
    bridge_id INTEGER,
    channel_id INTEGER,
    "begin" TIMESTAMP,
    "end" TIMESTAMP

);

CREATE TABLE IF NOT EXISTS channel_holds (
    id serial PRIMARY KEY,
    channel_id INTEGER,
    "begin" TIMESTAMP,
    "end" TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extension_dnd (
    id serial PRIMARY KEY,
    datetime TIMESTAMP,
    value VARCHAR(50),
    extension VARCHAR(50)
);


CREATE TABLE IF NOT EXISTS extension_lock (
    id serial PRIMARY KEY,
    datetime TIMESTAMP,
    value VARCHAR(50),
    type VARCHAR(50),
    extension VARCHAR(50),
    channel_id VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS holidays (
    id serial PRIMARY KEY,
    time_group_id INTEGER,
    datetime_start TIMESTAMP,
    datetime_end TIMESTAMP,
    work BOOLEAN
);


CREATE TABLE IF NOT EXISTS locations (
    id serial PRIMARY KEY,
    name VARCHAR(255),
    default_trunk_id INTEGER
);


CREATE TABLE IF NOT EXISTS queue_agents (
    id serial PRIMARY KEY,
    queue_id INTEGER,
    extension_id INTEGER,
    penalty INTEGER
);

CREATE TABLE IF NOT EXISTS queues (
    id serial PRIMARY KEY,
    name VARCHAR(255),
    active BOOLEAN,
    abandon_webhook TEXT
);

CREATE TABLE IF NOT EXISTS rule_run (

    rule_id INTEGER,
    channel_id INTEGER,
    datetime TIMESTAMP,
    previous_result VARCHAR(150),
    body TEXT
);

CREATE TABLE IF NOT EXISTS switch (
    id serial PRIMARY KEY,
    type VARCHAR(30),
    value VARCHAR(255),
    rule_id INTEGER,
    version VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS switch_rules (
    id serial PRIMARY KEY,
    value TEXT,
    time_group_id INTEGER,
    no_answer_rule_id INTEGER,
    off_hours_rule_id INTEGER
);

CREATE TABLE IF NOT EXISTS time_groups (
    id serial PRIMARY KEY,
    name VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS transfers (
    id serial PRIMARY KEY,
    target_channel_id INTEGER,
    channel_support_id_1 INTEGER,
    channel_support_id_2 INTEGER,
    transferee_channel_id INTEGER,
    transfer_type VARCHAR(100),
    datetime TIMESTAMP,
    transferee_extension_id INTEGER
);

CREATE TABLE IF NOT EXISTS trunks (
    id serial PRIMARY KEY,
    location_id INTEGER,
    title VARCHAR(255),
    name VARCHAR(255),
    main BOOLEAN,
    default_rule_id INTEGER,
    try_switch_in BOOLEAN,
    wait_exten BOOLEAN,
    number VARCHAR(50),
    tracking BOOLEAN
);

CREATE TABLE IF NOT EXISTS work_time (
    id serial PRIMARY KEY,
    time_group_id INTEGER,
    time TEXT,
    time_zone VARCHAR(150)
);