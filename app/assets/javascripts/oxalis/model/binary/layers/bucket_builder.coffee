Cube = require("../cube")

# Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
# object as expected by the server on bucket request
BucketBuilder = {

  fromZoomedAddress : ([x, y, z, zoomStep], options={}) ->

    bucket = {
      position : [
        x << (zoomStep + Cube::BUCKET_SIZE_P)
        y << (zoomStep + Cube::BUCKET_SIZE_P)
        z << (zoomStep + Cube::BUCKET_SIZE_P)
      ]
      zoomStep : zoomStep
      cubeSize : 1 << Cube::BUCKET_SIZE_P
    }

    if options.fourBit?
      bucket.fourBit = options.fourBit

    return bucket

}


module.exports = BucketBuilder
