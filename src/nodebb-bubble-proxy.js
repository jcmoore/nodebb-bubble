var url = require('url'),
    http = require('http'),
    stream = require('stream'),
    httpProxy = require('http-proxy'),
    WebSocketServer = require('ws').Server;

var metadata = require('./metadata.json');
var attributes = ["attr_instance", "attr_version", "attr_service", "attr_project"];
var endpoint = "";
var dot = "-dot-";

if (attributes.every(function valid (key) {
  var value = this[key];
  return value && value.indexOf("?") < 0;
}, metadata)) {
  endpoint = "http://"+attributes.map(function (key) {
    return this[key];
  }, metadata).join(dot)+".appspot.com";
}

console.log("redirection", endpoint);

//
// Create a proxy server with custom application logic
//
var proxy = httpProxy.createProxyServer({});

// To modify the proxy connection before data is sent, you can listen
// for the 'proxyReq' event. When the event is fired, you will receive
// the following arguments:
// (http.ClientRequest proxyReq, http.IncomingMessage req,
//  http.ServerResponse res, Object options). This mechanism is useful when
// you need to modify the proxy request before the proxy connection
// is made to the target.
//
proxy.on('proxyReq', function(proxyReq, req, res, options) {
  proxyReq.setHeader('X-Special-Proxy-Header', 'foobar');
});

var portListen = (0|process.env.PORT) || 8080;
var portSpeak = (0|process.env.PORT_NODEBB) || 4567;

var hostSpeak = "http://127.0.0.1"+":"+portSpeak;

var server = http.createServer(function(req, res) {
  // You can define here your custom logic to handle the request
  // and then proxy the request.

  var target = hostSpeak;
  var bodify = (req.headers["x-bodify-headers"] || "").trim();
  var pathify = (req.headers["x-pathify-params"] || "").trim();

  if (req.url.indexOf("/_ah/") === 0) {
    if (req.url === "/_ah/health" ||
       req.url === "/_ah/health/") {
      return proxy.web(req, res, {
        target: hostSpeak+"/api/",
      });
    } else {
      res.writeHead(404, {});
      return res.end("");
    }
  } else if (pathify || bodify) {
    if (pathify) {
      target += rewriteRequestPathUsingQueryParams(req.url, pathify.split(/\s*,\s*/g));
    }

    if (bodify) {
      return handleRequestBodyProxy(req, res, target, bodify);
    }
  } else if (req.url.search(/^\/(api|uploads)\//) !== 0) {
    if (endpoint &&
        (req.headers.host || "").split(dot).length < 4) {
      // redirect
      res.writeHead(301, {
        Location: endpoint+req.url,
      });

      return res.end();
    }
  }

  proxy.web(req, res, {
    target: target,
  });
});

var wss = new WebSocketServer({ server: server });

proxy.on('upgrade', function (req, socket, head) {
  proxy.ws(req, socket, head);
});

proxy.on('error', function (err, req, res) {
  res.writeHead(500, {

  });

  res.end('{"error":"unexpected error"}');
});

if (portListen === portSpeak) throw new Error("Cannot listen and proxy to same port ("+portListen+")");

console.log("listening on port "+portListen);
server.listen(portListen);



function transformSubstitue (segment, sub) {
  return segment.replace(sub[0], sub[1]);
}

function eachReplace (segment) {
  return this.reduce(transformSubstitue, segment);
}

function eachKeyToKVP (key) {
  return [key, this[key]];
}

function rewriteRequestPathUsingQueryParams (original, rewrite) {
  var parsed = url.parse(original, true);
  var substitutes = (rewrite.map(eachKeyToKVP, parsed.query));
  var modified = parsed.pathname.split("/").map(eachReplace, substitutes).join("/");
  parsed.pathname = modified;
  return url.format(parsed);
}



function rewriteRequestBodyUsingHeaders (original, rewrite, headers) {
  var substitutes = (rewrite.map(eachKeyToKVP, headers));
  var modified = substitutes.reduce(transformSubstitue, original);
  return modified;
}

function handleRequestBodyProxy (req, res, target, bodify) {
  var data = [];

  return new Promise(function (resolve) {
    req.on("data", function (datum) { data.push(datum); });
    req.on("end", resolve);
    req.on("error", resolve);
  }).then(function (err) {
    var original = Buffer.concat(data).toString();
    var modified = rewriteRequestBodyUsingHeaders(original, bodify.split(/\s*,\s*/g), req.headers);
    var buffer = new Buffer(modified);
    var piping = new stream.PassThrough();
    piping.end(buffer);

    return proxy.web(req, res, {
      target: target,
      buffer: piping,
      headers: { "Content-Length": buffer.length, },
    });
  }).catch(function () {
    res.writeHead(500);
    return res.end(JSON.stringify({
      error: "bodify",
    }));
  });
}
