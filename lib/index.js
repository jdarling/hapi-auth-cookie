// Load modules

var Boom = require('boom');
var Hoek = require('hoek');


// Declare internals

var internals = {};


exports.register = function (plugin, options, next) {

    plugin.auth.scheme('cookie', internals.implementation);
    next();
};


internals.implementation = function (server, options) {
    
    Hoek.assert(options, 'Missing cookie auth strategy options');
    Hoek.assert(!options.validateFunc || typeof options.validateFunc === 'function', 'Invalid validateFunc method in configuration');
    Hoek.assert(options.password, 'Missing required password in configuration');
    Hoek.assert(!options.appendNext || options.redirectTo, 'Cannot set appendNext without redirectTo');

    var settings = Hoek.clone(options);                        // Options can be reused
    settings.cookie = settings.cookie || 'sid';

    var cookieOptions = {
        encoding: 'iron',
        password: settings.password,
        isSecure: settings.isSecure !== false,                  // Defaults to true
        path: '/',
        isHttpOnly: settings.isHttpOnly !== false               // Defaults to true
    };

    if (settings.ttl) {
        cookieOptions.ttl = settings.ttl;
    }

    server.state(settings.cookie, cookieOptions);

    if (typeof settings.appendNext === 'boolean') {
        settings.appendNext = (settings.appendNext ? 'next' : '');
    }

    var scheme = {
        authenticate: function (request, reply) {

            var validate = function () {

                // Check cookie

                var session = request.state[settings.cookie];
                if (!session) {
                    return unauthenticated(Boom.unauthorized());
                }

                if (!settings.validateFunc) {
                    return reply(null, { credentials: session });
                }

                settings.validateFunc(session, function (err, isValid, credentials) {

                    if (err ||
                        !isValid) {

                        if (settings.clearInvalid) {
                            reply.unstate(settings.cookie);
                        }

                        return unauthenticated(Boom.unauthorized('Invalid cookie'), { credentials: credentials, log: (err ? { data: err } : 'Failed validation') });
                    }

                    if (credentials) {
                        reply.state(settings.cookie, credentials);
                    }

                    return reply(null, { credentials: credentials || session });
                });
            };

            var unauthenticated = function (err, result) {

                if (!settings.redirectTo) {
                    return reply(err, result);
                }

                var uri = settings.redirectTo;
                if (settings.appendNext) {
                    if (uri.indexOf('?') !== -1) {
                        uri += '&';
                    }
                    else {
                        uri += '?';
                    }

                    uri += settings.appendNext + '=' + encodeURIComponent(request.url.path);
                }

                return reply('You are being redirected...', result).redirect(uri);
            };

            validate();
        },
        extend: function (request) {

            Hoek.assert(!request.auth.session, 'The cookie scheme may not be registered more than once');

            // Decorate request

            request.auth.session = {
                set: function (session) {

                    Hoek.assert(session && typeof session === 'object', 'Invalid session');
                    request._setState(settings.cookie, session);
                },
                clear: function () {

                    request._clearState(settings.cookie);
                }
            };
        }
    };

    return scheme;
};
