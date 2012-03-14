package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import play.mvc.Results.Redirect
import play.Logger
import java.text.SimpleDateFormat
import java.util.TimeZone
import brainflight.binary.{ FileDataStore, GridFileDataStore }
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import com.mongodb.casbah.Imports._
import com.mongodb.casbah.gridfs.Imports._

object Admin extends Controller {
  
  val xBot = 5
  val xTop = 5
  val yBot = 0
  val yTop = 20
  val zBot = 0
  val zTop = 20

  def timeGridFS() = Action {

    var gridFileDataStoreTime = -System.currentTimeMillis()
    Logger.info("outside loop")
    for {
      x <- xBot to xTop
      y <- yBot to yTop
      z <- zBot to zTop
    } {
      Logger.info("inside loop")
      GridFileDataStore.load(Tuple3(x * 128, y * 128, z * 256))
    }
    gridFileDataStoreTime += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    GridFileDataStore.cleanUp()
    Ok("GridFS needed %s\n %d %d %d %d %d %d".format(sdf.format(gridFileDataStoreTime), xBot, xTop, yBot, yTop, zBot, zTop))
  }

  def timeFileDataStore() = Action {
    var fileDataStoreTime = -System.currentTimeMillis()
    Logger.info("outside loop")
    for {
      x <- xBot to xTop
      y <- yBot to yTop
      z <- zBot to zTop
    } {
      Logger.info("inside loop")
      FileDataStore.load(Tuple3(x * 128, y * 128, z * 256))
    }
    fileDataStoreTime += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    FileDataStore.cleanUp()
    Ok("FileDataStore needed %s".format(sdf.format(fileDataStoreTime)))
  }

  /*
  def testGridFS = Action{
    
    var fileDataStoreTime = -System.currentTimeMillis()
    for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 15*256 until 16*256 by 2}
    {
      FileDataStore.load(Tuple3(x,y,z))
    }
    fileDataStoreTime += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    Logger.info("FileDatastore needed: %s".format(sdf.format(fileDataStoreTime)))
    
    var gridFileDataStoreTime = -System.currentTimeMillis()
    for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 15*256 until 16*256 by 2}
    {
      GridFileDataStore.load(Tuple3(x,y,z))
    }
    gridFileDataStoreTime += System.currentTimeMillis()
    Logger.info("GridFileDatastore needed: %s".format(sdf.format(gridFileDataStoreTime)))
    Ok("done")
  }*/
}


