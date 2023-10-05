import sbt._

object DependencyResolvers {
  val atlassian = "Atlassian Releases" at "https://maven.atlassian.com/public/"
  val sciJava = "SciJava Public" at "https://maven.scijava.org/content/repositories/public/"
  val senbox = "Senbox (for Zarr)" at "https://nexus.senbox.net/nexus/content/groups/public/"

  val dependencyResolvers: Seq[Serializable] = Seq(
    Resolver.sonatypeOssRepos("releases"),
    Resolver.sonatypeOssRepos("snapshots"),
    Resolver.typesafeRepo("releases"),
    sciJava,
    atlassian,
    senbox
  )
}
