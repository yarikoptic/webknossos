class 3d_engine

	#private Properties
	empty_func = -> 
	gl = null
	canvas = null


	# for calculating fps
	frames = 0
	frameRate = 0
	frameCount = 0
	lastTime


	#public Properties
	VERSION = 0.1
	usersRender = empty_func
	geometry = []
	shaderProgram = null


	#public methods 

	###
	Set a uniform integer
	@param {String} varName
	@param {Number} varValue
	###
	uniformi = (varName, varValue) ->
		var Location = gl.getUniformLocation(shaderProgram, varName)
		if varLocation isnt null
			if varValue.length is 4
				gl.uniform4iv varLocation, varValue
			else if varValue.length is 3
				gl.uniform3iv varLocation, varValue
			else if varValue.length is 2
				gl.uniform2iv varLocation, varValue
			else
				gl.uniform1i varLocation, varValue
		else
		console.log "uniform var '" + varName + "' was not found."

	###
	Set a uniform float
	@param {String} varName
	@param {Number} varValue
	###
	uniformf = (varName, varValue) ->
		var Location = gl.getUniformLocation(shaderProgram, varName)
		if varLocation isnt null
			if varValue.length is 4
				gl.uniform4fv varLocation, varValue
			else if varValue.length is 3
				gl.uniform3fv varLocation, varValue
			else if varValue.length is 2
				gl.uniform2fv varLocation, varValue
			else
				gl.uniform1f varLocation, varValue
		else
		console.log "uniform var '" + varName + "' was not found."

	###
	Sets a uniform matrix.
	@param {String} varName
	@param {Boolean} transpose must be false
	@param {Array} matrix
	###
	uniformMatrix = (varName, transpose, matrix) ->
		varLocation = ctx.getUniformLocation(shaderProgram, varName)
		if varLocation isnt null
			if matrix.length is 16
				gl.uniformMatrix4fv varLocation, transpose, matrix
			else if matrix.length is 9
				gl.uniformMatrix3fv varLocation, transpose, matrix
			else
				gl.uniformMatrix2fv varLocation, transpose, matrix
		else
		console.log "Uniform matrix '" + varName + "' was not found."



	#private methods

	###
	@param {String} varName
	@param {Number} size
	@param {} VBO
	###
	vertexAttribPointer = (varName, size, VBO) ->
		varLocation = ctx.getAttribLocation(shaderProgram, varName)
		if varLocation isnt -1
			gl.bindBuffer gl.ARRAY_BUFFER, VBO
			gl.vertexAttribPointer varLocation, size, gl.FLOAT, false, 0, 0
			gl.enableVertexAttribArray varLocation
		else
			console.log "Vertex attrib '" + varName + "' was not found."

	###
	Create a buffer object which will contain
	the Vertex buffer object for the shader

	A 3D context must exist before calling this function

	@param {Array} data
	@param {Boolean} isElementBuffer

	@returns {Object}
	###

	createBufferObject = (data, isElementBuffer = false) ->
		if gl
			VBO = gl.CreateBuffer()
			if isElemetBuffer
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, VBO)
				gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW)
			else
				gl.bindBuffer(gl.ARRAY_BUFFER, VBO)
				gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)	
			return VBO			

				 
# weiter mit 330


















