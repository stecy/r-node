/*
    Copyright 2010 Jamie Love

    This file is part of the "R-Node Server".

    R-Node Server is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2.1 of the License, or
    (at your option) any later version.

    R-Node Server is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with R-Node Server.  If not, see <http://www.gnu.org/licenses/>.
*/

var SYS     = require("sys");
var FS      = require("fs");
var UTILS   = require("../rnodeUtils");
var URL     = require("url");
var HTTP    = require('http');
var helpVarId = 0;

exports.name = "/help";

var helpServer = null;
var helpServerPort = 0;
var rRoot = "";

function help_2_10_callback (req, resp, sid, rNodeApi) {

    var url = URL.parse (req.url, true);
    var r = rNodeApi.getRConnection(sid, true)

    if (!helpServer) {
        helpServer = HTTP.createClient(helpServerPort, "127.0.0.1");
    }

    if (url.query && url.query.search) {
        var request = url.query.search;
        var Rcmd = 'help(\'' + request.replace ('\'', '\\\'') + '\', help_type="html")';

        r.request(Rcmd, function (rResp) {
            if (rResp && rResp.values && rResp.values.length == 1) { 

                // We are provided with a file, which we redirect through the HTTP server
                var file = rResp.values[0].substr (rRoot.length);

                var request = helpServer.request(file,
                    {'Host': '127.0.0.1:' + helpServerPort,
                     'Connection': 'keep-alive' }); // Required otherwise R server does't return a 200, it returns a 400 complaining about missing host. 
                
                request.addListener('response', function (response) {
                    resp.writeHeader(200, response.headers);
                    response.addListener('data', function (chunk) {
                        resp.write(chunk);
                    });
                    response.addListener('end', function () { resp.end(); });
                });
                request.end();

            } else {
                resp.writeHeader(404, { "Content-Type": "text/plain" });
                resp.write("Help doesn't appear to exist for '" + request + "'.");
                resp.end();
            }
        });
    } else {
        
        // R 2.9 has the following URL, while we need a different URL,
        // we make a change for it...
        var f = url.href.replace('/help', '');
        if (f == '/base/html/00Index.html') {
            resp.writeHeader(301, { 
               "Content-Type": "text/plain"
               ,"Location": '/help/doc/html/index.html'
            });
            resp.end();
            return;
        }

        var request = helpServer.request(f,
            {'Host': '127.0.0.1:' + helpServerPort,
             'Connection': 'keep-alive' }); // Required otherwise R server does't return a 200, it returns a 400 complaining about missing host. 
        
        request.addListener('response', function (response) {
            resp.writeHeader(200, response.headers);
            response.addListener('data', function (chunk) {
                resp.write(chunk);
            });
            response.addListener('end', function () { resp.end(); });
        });
        request.end();
    }
}

function help_2_10 (req, resp, sid, rNodeApi) {
    var ctx = rNodeApi.getSidContext (sid, true);
    var r = rNodeApi.getRConnection(sid, true)

    if (!helpServerPort) {
        resp.writeHeader(500, { "Content-Type": "text/plain" });
        resp.write("Help server is not configured.");
        resp.end();
        return true;
    }

    if (!ctx.rNodeHelpSetup) {
        var setupCmd = "options( browser = function(url, ...)  url )";
        r.request(setupCmd, function (rResp) {
            ctx.rNodeHelpSetup = true;
            help_2_10_callback (req, resp, sid, rNodeApi);
        });
    } else {
        help_2_10_callback (req, resp, sid, rNodeApi);
    }
    return true;
}

function help_2_9(req, resp, sid, rNodeApi) {
    var url = URL.parse (req.url, true);

    if (url.query && url.query.search) {
        var helpVar = 'rnode_help_' + helpVarId++;
        var request = url.query.search;
        var Rcmd = helpVar + ' <- help(\'' + request.replace ('\'', '\\\'') + '\')';
        var r = rNodeApi.getRConnection(sid, true)
        
        r.request(Rcmd, function (rResp) {
            if (rResp.values) {
                var helpfile = rResp.values[0];
                // Replace the last part of the filepath with the equivalent HTML filename
                // and then redirect the user.
                var matches = /^.*\/library\/(.*)\/help\/([^\/]+)/.exec (helpfile);

                if (!matches || matches.length != 3) {
                    rNodeApi.log(req, "Cannot find help file for '" + request + "', received: '" + helpfile + "'");
                    resp.writeHeader(404, { "Content-Type": "text/plain" });
                    resp.write("No help found");
                    resp.end();
                    return;
                }

                var htmlHelpFile = '/help/' + matches[1] + '/html/' + matches[2] + '.html';

                resp.writeHeader (301, { 
                    'Location': htmlHelpFile,
                    'Content-Type': "text/html",
                });
                resp.write (" <html> <head> <title>Moved</title> </head> <body> <h1>Moved</h1> <p>page has moved to <a href='" + htmlHelpFile + "'>" + htmlHelpFile + "</a>.</p> </body> </html>" );
                resp.end();

                // Remove our temporary variable
                r.request ('rm(\'' + helpVar + '\')', function (r) {});

            } else {
                resp.writeHeader(404, { "Content-Type": "text/plain" });
                resp.end();
            }
        });
    } else { // else we're requesting a specific file. Find the file.
        var path = rNodeApi.config.R.root + '/library/' + url.href.replace('/help', '');
        FS.realpath(path, function (err, resolvedPath) {
            if (err) {
                rNodeApi.log(req, 'Error getting canonical path for ' + path + ': ' + err);
                resp.writeHeader(404, { "Content-Type": "text/plain" });
                resp.write ("Error finding help file. You may be missing R help.\nFor example, in ubuntu, ensure the package \"r-core-html\" is installed.");
                resp.end();
            } else {
                if (resolvedPath.search('^' + rNodeApi.config.R.root + '/library/') != 0) {
                    rNodeApi.log(req, 'Resolved path \'' + resolvedPath + '\' not within right directory.');
                    resp.writeHeader(404, { "Content-Type": "text/plain" });
                    resp.end();
                } else {
                    UTILS.streamFile (resolvedPath, resp, 'text/html');
                }
            }
        });
    }
    return true;
}

exports.init = function (rNodeApi) {
    helpServerPort = rNodeApi.config.features.help ? rNodeApi.config.features.help.serverPort : 0;
    rRoot = rNodeApi.config.R.root;
}

exports.handle = function (req, resp, sid, rNodeApi) {
    if (rNodeApi.Rversion()[1] <= 9) {
        return help_2_9(req, resp, sid, rNodeApi);
    } else {
        return help_2_10(req, resp, sid, rNodeApi);
    }
}

exports.canHandle = function (req, rNodeApi) {
    return req.url.beginsWith ('/help');
}
