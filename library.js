"use strict";
/* globals module, require, __dirname */

var plugin = {},
	db = module.parent.require('./database');

var nconf = module.parent.require('nconf'),
	async = module.parent.require('async'),
	mkdirp = module.parent.require('mkdirp'),
	winston = module.parent.require('winston'),
	express = module.parent.require('express'),
	middleware;

var	fs = require('fs'),
	path = require('path');

function renderCustomPage(req, res) {
	var path = req.path.replace(/\/(api\/)?/, '').replace(/\/$/, '');
	res.render('custom-pages/' + path, {
		title: plugin.pagesHash[path].name
	});
}

function renderAdmin(req, res) {
	getCustomPages(function(err, data) {
		res.render('admin/custom-pages', {
			pages: data
		});
	});
}

function getCustomPages(callback) {
	if (plugin.pagesCache) {
		return callback(null, plugin.pagesCache);
	} else {
		db.get('plugins:custom-pages', function(err, data) {
			try {
				var pages = JSON.parse(data);

				if (pages == null) {
					pages = [];
				}

				// Eliminate errors in route definition
				plugin.pagesCache = pages.map(function(pageObj) {
					pageObj.route = pageObj.route.replace(/^\/*/g, '');	// trim leading slashes from route
					return pageObj;
				});

				plugin.pagesHash = plugin.pagesCache.reduce(function(memo, cur) {
					memo[cur.route] = cur;
					return memo;
				}, {});

				callback(null, plugin.pagesCache);
			} catch (err) {
				callback(err);
			}
		});
	}
}

plugin.setWidgetAreas = function(areas, callback) {
	getCustomPages(function(err, data) {
		for (var d in data) {
			if (data.hasOwnProperty(d)) {
				areas = areas.concat([
					{
						'name': data[d].name + ' Header',
						'template': 'custom-pages/' + data[d].route + '.tpl',
						'location': 'header'
					},
					{
						'name': data[d].name + ' Footer',
						'template': 'custom-pages/' + data[d].route + '.tpl',
						'location': 'footer'
					},
					{
						'name': data[d].name + ' Sidebar',
						'template': 'custom-pages/' + data[d].route + '.tpl',
						'location': 'sidebar'
					},
					{
						'name': data[d].name + ' Content',
						'template': 'custom-pages/' + data[d].route + '.tpl',
						'location': 'content'
					}
				]);
			}
		}

		callback(err, areas);
	});
};

plugin.addAdminNavigation = function(header, callback) {
	header.plugins.push({
		route: '/custom-pages',
		icon: 'fa-mobile',
		name: 'Custom Static Pages'
	});

	callback(null, header);
};

plugin.addNavigation = function(header, callback) {
	getCustomPages(function(err, data) {
		for (var d in data) {
			if (data.hasOwnProperty(d)) {
				header.push({
					"class": data[d].class,
					"route": "/" + data[d].route,
					"text": data[d].name,
					"title": data[d].name
				});
			}
		}

		callback(null, header);
	});
};

plugin.init = function(params, callback) {
	var app = params.router;

	middleware = params.middleware;

	app.get('/admin/custom-pages', middleware.admin.buildHeader, renderAdmin);
	app.get('/api/admin/custom-pages', renderAdmin);

	var SocketAdmin = module.parent.require('./socket.io/admin');
	SocketAdmin.settings.saveCustomPages = function(socket, data, callback) {
		delete plugin.pagesCache;
		delete plugin.pagesHash;

		async.series([
			async.apply(db.set, 'plugins:custom-pages', JSON.stringify(data)),
			async.apply(plugin.reloadRoutes)
		], callback);
	};

  getCustomPages(function(err, pages) {
    async.each(pages, function(page, next) {
      var route = page.route;

      app.get('/' + route, middleware.buildHeader, renderCustomPage);
      app.get('/api' + route, renderCustomPage);
    }, callback)
  })
};

plugin.reloadRoutes = function(callback) {
	var pagesRouter = express.Router(),
		helpers = module.parent.require('./routes/helpers');

	fs.readFile(path.join(__dirname, 'templates/custom-page.tpl'), function(err, customTPL) {
		customTPL = customTPL.toString();

		getCustomPages(function(err, pages) {
			async.each(pages, function(pageObj, next) {
				var route = pageObj.route;

				if (path.dirname(route) !== '.') {
					// Subdirectories specified
					mkdirp(path.join(__dirname, 'templates/custom-pages', path.dirname(route)), function(err) {
						if (err) {
							return next(err);
						}

						fs.writeFile(path.join(__dirname, 'templates/custom-pages', route + '.tpl'), customTPL, next);
					});
				} else {
					fs.writeFile(path.join(__dirname, 'templates/custom-pages', route + '.tpl'), customTPL, next);
				}
			}, function(err) {
				if (err) {
					winston.error('[plugin/custom-pages] Could not re-initialise routes!');
					winston.error('  ' + err.message);
					return callback(err);
				}

				callback();
			});
		});
	});
};

module.exports = plugin;
