read_binary_file = ->

	# COPIED FROM PSAPI.JS::THIS.LOAD
	newPointCloud = 
		VBOs: []
		attributes: {}
		usingColor: false
		progress: 0
		getProgress: ->
			@progress
		  
		status: -1
		getStatus: ->
			@status
		  
		addedVertices: [ 0, 0, 0 ]
		center: [ 0, 0, 0 ]
		getCenter: ->
			@center
		  
		numTotalPoints: -1
		getNumTotalPoints: ->
			@numTotalPoints
		  
		numPoints: -1
		getNumPoints: ->
			@numPoints


	# PUSH SOMETHING ON PARSER STACK TO NOT MESS UP PS API FUNCTIONS
	# SPECIFICALLY psapi.js::parseCallback and psapi.js::getParserIndex
	parser = {}
	parser.progress = 0
	ps.parsers.push parser

	ps.pointClouds.push newPointCloud
		
	# DOWNLOAD FILE
	xhr = new XMLHttpRequest()
	xhr.open "GET", "/BrainFlight/WebGl/Image/z0000/100527_k0563_mag1_x0017_y0017_z0000.raw", true
	xhr.responseType = "arraybuffer"

	xhr.onload = (e) -> 
		grey_scale_colors = new Uint8Array(this.response)
		
		# HEIGHT, WIDTH, DEPTH of block
		#dimensions = Math.pow grey_scale_colors.length, 1/3
		dimensions = 128
		
		numVerts = grey_scale_colors.length
		
		# RAW PARSING
		vertices = new Float32Array(numVerts * 3)
		RGB_colors = new Float32Array(numVerts * 3)
		currentPixel = 0
	
		for x in [0..127.0] by 0.5
			for y in [0..127.0] by 0.5
				for z in [0..1.0] by 0.5
					# ADD COORDINATES
					vertices[currentPixel] = x
					vertices[currentPixel + 1] = y
					vertices[currentPixel + 2] = z
					
					# GREY SCALE TO RGB COLOR CONVERTION
					# R = G = B = GREY SCALE INTEGER
					RGB_colors[currentPixel] = grey_scale_colors[currentPixel] / 255
					RGB_colors[currentPixel + 1] =  grey_scale_colors[currentPixel] / 255
					RGB_colors[currentPixel + 2] = grey_scale_colors[currentPixel] / 255
					
					newPointCloud.numParsedPoints = x+y+z
					currentPixel += 3

		# SKIP USING A "TRADITIONAL" POINTSTREAM PARSER AND CALL psapi.js::parseCallback DIRECTLY
		ps.parseCallback parser, { "ps_Vertex" : vertices, "ps_Color" : RGB_colors }
		
		# OTHER POINTSTREAM VALUES / CALLBACKS
		newPointCloud.numTotalPoints = newPointCloud.numParsedPoints
		parser.progress = 1
		#ps.loadedCallback parser
		
	xhr.send()
	return newPointCloud