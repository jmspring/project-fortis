FROM node:9.2.0

RUN apt-get install -y --no-install-recommends wget ca-certificates \
 && wget -q http://www-eu.apache.org/dist/cassandra/3.11.0/apache-cassandra-3.11.0-bin.tar.gz \
 && tar xfz apache-cassandra-3.11.0-bin.tar.gz \
 && rm apache-cassandra-3.11.0-bin.tar.gz \
 && mv apache-cassandra-3.11.0 /opt/cassandra

WORKDIR /app
ADD package.json /app/package.json
RUN npm install
ADD src /app/src
ADD server.js /app/server.js
ADD config.js /app/config.js

ADD docker/run-node.sh /app/server
ADD docker/run-cqlsh.sh /app/cqlsh
CMD /app/server

# this is a production service so run it on the standard web port
EXPOSE 80
ENV PORT="80"

# these settings need to be in sync with project-fortis-spark
ENV PUBLISH_EVENTS_EVENTHUB_PATH="published-messages"
ENV PUBLISH_EVENTS_EVENTHUB_PARTITION="\$Default"
ENV FORTIS_SB_CONFIG_QUEUE="configuration"
ENV FORTIS_SB_COMMAND_QUEUE="command"

# access keys for azure resources, these are created via the azure deployment
ENV PUBLISH_EVENTS_EVENTHUB_CONNECTION_STRING=""
ENV FORTIS_SB_CONN_STR=""
ENV USER_FILES_BLOB_ACCOUNT_NAME=""
ENV USER_FILES_BLOB_ACCOUNT_KEY=""
ENV APPINSIGHTS_INSTRUMENTATIONKEY=""

# setting up the feature service is a lengthy process so we provide a shared
# instance for convenience; if you wish to run this service locally, please
# follow the instructions at https://github.com/CatalystCode/featureService and
# then update the value of this environment variable to http://localhost:3035
ENV FORTIS_FEATURE_SERVICE_HOST="http://fortis-features.eastus.cloudapp.azure.com"

# a one-node local cassandra is set up via docker-compose, if you wish to use a
# larger cluster (e.g. hosted in Azure), just override this variable with the
# hostname of your cluster
ENV FORTIS_CASSANDRA_HOST="localhost"
ENV FORTIS_CASSANDRA_PORT="9042"
ENV FORTIS_CASSANDRA_USERNAME="cassandra"
ENV FORTIS_CASSANDRA_PASSWORD="cassandra"
ENV FORTIS_CASSANDRA_REPLICATION_FACTOR="3"

# the cql file at this url is used to set up the initial schema for the
# cassandra database; you don't want to change this value unless you're
# developing a schema migration
ENV FORTIS_CASSANDRA_SCHEMA_URL="https://raw.githubusercontent.com/CatalystCode/project-fortis/master/project-fortis-pipeline/ops/storage-ddls/cassandra-setup.cql"

# the tar.gz file at this url is used to populate the cassandra database with
# initial data; this is used for development setup to enable shared test data
# and also for production to enable importing exported fortis sites
# the archive at the url is expected to contain an import.cql file which may
# reference other files in the archive, e.g. for cql `copy from` commands
ENV FORTIS_CASSANDRA_SEED_DATA_URL=""

# if no seed data is specified, use the following two variables to set up the
# Fortis site site types include 'climate', 'health' and 'humanitarian' and
# drive default terms that the pipeline will monitor
ENV FORTIS_CASSANDRA_SITE_NAME=""
ENV FORTIS_CASSANDRA_SITE_TYPE=""

# active directory configuration
# you can set up your own active directory application following the setps here:
# https://github.com/CatalystCode/project-fortis/blob/master/project-fortis-pipeline/docs/aad-setup.md
# when setting up the application in the "Redirect URLs" configuration ensure to
# add http://localhost:8888 and http://localhost:3000 so that your app works
# via docker-compose but also if run stand-alone via npm start
# the log level determines how much information the passport-active-directory
# module will output; 'info' is usually plenty to trouble-shoot issues
ENV AD_CLIENT_ID=""
ENV AD_LOG_LEVEL="warn"

# mapbox credentials
# you can create a new mapbox access token for free at https://www.mapbox.com/signup/
# the token will be persisted to cassandra on first load and is changable via
# the admin settings UI afterwards
ENV MAPBOX_ACCESS_TOKEN=""

# cognitive services text analytics credential
# https://azure.microsoft.com/en-us/services/cognitive-services/text-analytics/
# the service is used for sentiment analysis in the spark pipeline
# the token will be persisted to cassandra on first load and is changable via
# the admin settings UI afterwards
ENV COGNITIVE_TEXT_SERVICE_TOKEN=""

# cognitive services image analysis credential
# https://azure.microsoft.com/en-us/services/cognitive-services/computer-vision/
# the service is used for analysis of images in the spark pipeline if a source
# like instagram is specified
# the token will be persisted to cassandra on first load and is changable via
# the admin settings UI afterwards
ENV COGNITIVE_VISION_SERVICE_TOKEN=""

# cognitive services speech transcription credential
# https://azure.microsoft.com/en-us/services/cognitive-services/speech/
# the service is used for transcription of radio in the spark pipeline if a
# source like radio is specified
# the token will be persisted to cassandra on first load and is changable via
# the admin settings UI afterwards
ENV COGNITIVE_SPEECH_SERVICE_TOKEN=""

# cognitive services text translation credential
# https://azure.microsoft.com/en-us/services/cognitive-services/translator-text-api/
# the service is used for translation of events in the user interface
# the token will be persisted to cassandra on first load and is changable via
# the admin settings UI afterwards
ENV COGNITIVE_TRANSLATION_SERVICE_TOKEN=""
