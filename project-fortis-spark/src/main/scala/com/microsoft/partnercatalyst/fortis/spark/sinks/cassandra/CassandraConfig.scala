package com.microsoft.partnercatalyst.fortis.spark.sinks.cassandra

import com.microsoft.partnercatalyst.fortis.spark.FortisSettings
import org.apache.spark.SparkConf
import org.apache.spark.streaming.Duration

import scala.util.Properties.envOrElse

object CassandraConfig {
  def init(conf: SparkConf, batchDuration: Duration, fortisSettings: FortisSettings): SparkConf = {
    conf
      .setIfMissing("spark.cassandra.connection.host", fortisSettings.cassandraHosts)
      .setIfMissing("spark.cassandra.connection.port", fortisSettings.cassandraPorts)
      .setIfMissing("spark.cassandra.auth.username", fortisSettings.cassandraUsername)
      .setIfMissing("spark.cassandra.auth.password", fortisSettings.cassandraPassword)
      .setIfMissing("spark.cassandra.connection.keep_alive_ms", envOrElse("CASSANDRA_KEEP_ALIVE_MS", (batchDuration.milliseconds * 2).toString))
      .setIfMissing("spark.cassandra.connection.factory", "com.microsoft.partnercatalyst.fortis.spark.sinks.cassandra.FortisConnectionFactory")
      .set("spark.cassandra.output.batch.size.bytes", "5120")
      .set("spark.cassandra.output.concurrent.writes", "16")
  }
}
