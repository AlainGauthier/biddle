/*jshint laxbreak: true*/
/*jslint node: true, for: true*/
(function biddle() {
    "use strict";
    var node     = {
            child : require("child_process").exec,
            crypto: require("crypto"),
            fs    : require("fs"),
            http  : require("http"),
            https : require("https"),
            path  : require("path")
        },
        text     = { // List of ANSI formatting instructions
            normal   : "\u001b[0m",
            bold     : "\u001b[1m",
            underline: "\u001b[4m",
            red      : "\u001b[31m",
            green    : "\u001b[32m",
            yellow   : "\u001b[33m",
            blue     : "\u001b[34m",
            purple   : "\u001b[35m",
            cyan     : "\u001b[36m",
            nocolor  : "\u001b[39m",
            none     : "\u001b[39m\u001b[0m"
        },
        commands = { // The list of supported biddle commands.
            commands : "List the supported commands to the console.",
            copy     : "Copy files or directory trees from one location to another on the local file sys" +
                          "tem.",
            get      : "Get something via http/https.",
            global   : "Make an installed application into a global command in the terminal.",
            hash     : "Generate a hash sequence against a file.",
            help     : "Parse biddle's readme.md to the terminal.",
            install  : "Install a published application.",
            list     : "List installed and/or published applications.",
            markdown : "Parse any markdown and output to terminal.",
            publish  : "Publish an application/version.",
            remove   : "Remove a file or directory from the local file system.",
            status   : "Determine if version on installed applications are behind the latest published v" +
                          "ersion.",
            test     : "Test automation.",
            uninstall: "Uninstall an application installed by biddle.",
            unpublish: "Unpublish an application published by biddle.",
            unzip    : "Unzip a zip file.",
            zip      : "Zip a file or directory."
        },
        data     = {
            abspath      : "", // Local absolute path to biddle.
            address      : {
                applications: "", // Local absolute path where applications will be installed to.
                downloads   : "", // Local absolute path to biddle download directory.
                publications: "", // Local absolute path where applications will be published to.
                target      : "" // Location where files will be written to.
            },
            applications : "applications", // default place to store installed applications
            childtest    : false, // If the current biddle instance is a child of another biddle instance (occurs due to test automation)
            command      : "", // Executed biddle command.
            cwd          : process.cwd(), // Current working directory before running biddle.
            filename     : "", // Stores an inferred file name when files need to be written and a package.json is not used, such as the get command.
            hashFile     : "", // Stores hash value from reading a downloaded hash file.  Used for hash comparison with the install command.
            hashZip      : "", // Stores locally computed hash value for a downloaded zip file.  Used for hash comparison with the install command.
            ignore       : [], // List of relative locations to ignore from the .biddlerc file's exclusions object.
            input        : [], // Normalized process.argv list.
            installed    : {}, // Parsed data of the installed.json file.  Data about applications installed with biddle.
            latestVersion: false, // Used in the publish command to determine if the application is the latest version
            packjson     : {}, // Parsed data of a directory's package.json file.  Used with the publish command.
            publications : "publications", // default location to store published applications
            published    : {}, // Parsed data of the published.json file.  Data about applications published by biddle.
            sudo         : false // If biddle is executed with administrative rights in POSIX.
        },
        cmds     = { // The OS specific commands executed outside Node.js
            pathRead  : function biddle_cmds_pathRead() { // Used in command global to read the OS's stored paths
                return "powershell.exe -nologo -noprofile -command \"[Environment]::GetEnvironmentVariab" +
                        "le('PATH','Machine');\"";
            },
            pathRemove: function biddle_cmds_pathRemove(cmdFile) { // Used in command global to remove the biddle path from the Windows path list
                return "powershell.exe -nologo -noprofile -command \"$PATH='" + cmdFile + "';[Environment]::SetEnvironmentVariable('PATH',$PATH,'Machine');\"";
            },
            pathSet   : function biddle_cmds_pathSet(appspath) { // Used in command global to add the biddle path to the Windows path list
                return "powershell.exe -nologo -noprofile -command \"$PATH=[Environment]::GetEnvironment" +
                        "Variable('PATH');[Environment]::SetEnvironmentVariable('PATH',$PATH + ';" + appspath + "cmd','Machine');\"";
            },
            remove    : function biddle_cmds_remove(dir) { // Recursively and forcefully removes a directory tree or file from the file system
                if (data.platform === "win32") {
                    return "powershell.exe -nologo -noprofile -command \"rm " + dir + " -r -force\"";
                }
                return "rm -rf " + dir;
            },
            unzip     : function biddle_cmds_unzip(filename) { // Unzips a zip archive into a collection
                if (data.platform === "win32") {
                    return "powershell.exe -nologo -noprofile -command \"& { Add-Type -A 'System.IO.Compress" +
                            "ion.FileSystem'; [IO.Compression.ZipFile]::ExtractToDirectory('" + filename + "', '" + data.address.target + "'); }\"";
                }
                return "unzip -oq " + filename + " -d " + data.address.target;
            },
            zip       : function biddle_cmds_zip(filename, file) { // Stores all items of the given directory into a zip archive directly without creating a new directory. Locations resolved by a symlink are stored, but the actual symlink is not stored.
                if (data.platform === "win32") {
                    return "powershell.exe -nologo -noprofile -command \"& { Add-Type -A 'System.IO.Compress" +
                            "ion.FileSystem'; [IO.Compression.ZipFile]::CreateFromDirectory('.', '" + filename + "'); }\"";
                }
                if (file === "") {
                    return "zip -r9yq " + filename + " ." + node.path.sep + " *.[!.]";
                }
                return "zip -r9yq " + filename + " " + file;
            }
        },
        apps     = {};
    apps.commands    = function biddle_commands() {
        var keys = Object.keys(commands),
            len  = keys.length,
            comm = "",
            lens = 0,
            a    = 0,
            b    = 0;
        console.log(text.underline + "biddle Commands" + text.normal);
        console.log("");
        do {
            if (keys[a].length > lens) {
                lens = keys[a].length;
            }
            a += 1;
        } while (a < len);
        a = 0;
        do {
            comm = keys[a];
            b    = comm.length;
            if (b < lens) {
                do {
                    comm = comm + " ";
                    b    += 1;
                } while (b < lens);
            }
            console.log(text.cyan + comm + text.nocolor + ": " + commands[keys[a]]);
            a += 1;
        } while (a < len);
    };
    apps.commas      = function biddle_commas(number) {
        var str = String(number),
            arr = [],
            a   = str.length;
        if (a < 4) {
            return str;
        }
        arr = String(number).split("");
        a   = arr.length;
        do {
            a      -= 3;
            arr[a] = "," + arr[a];
        } while (a > 3);
        return arr.join("");
    };
    apps.copy        = function biddle_copy(target, destination, exclusions, callback) {
        var numb  = {
                dirs : 0,
                end  : 0,
                files: 0,
                links: 0,
                start: 0
            },
            exlen = exclusions.length,
            util  = {};
        util.complete = function biddle_copy_complete(item) {
            numb.end += 1;
            if (numb.end === numb.start) {
                if (data.command === "copy") {
                    console.log("Copied " + target + " to " + destination);
                    console.log("Files: " + numb.files + ", Directories: " + numb.dirs + ", Symlinks: " + numb.links);
                }
                callback();
            }
            return item;
        };
        util.eout     = function biddle_copy_eout(er, name) {
            var filename = target.split(node.path.sep);
            apps.rmrecurse(destination + node.path.sep + filename[filename.length - 1], function biddle_copy_eout_rmrecurse() {
                apps.errout({
                    error: er,
                    name : name
                });
            });
        };
        util.dir      = function biddle_copy_dir(item, dest) {
            var readdir = function biddle_copy_dir_readdir() {
                node
                    .fs
                    .readdir(item, function biddle_copy_dir_readdir_callback(err, files) {
                        if (err !== null) {
                            return util.eout(err, "biddle_copy_dir_readdir_callback");
                        }
                        if (files.length > 0) {
                            numb.end += 1;
                            files.forEach(function biddle_copy_dir_readdir_callback_each(value) {
                                util.stat(item + node.path.sep + value,
                                dest);
                            });
                        } else {
                            util.complete(item);
                        }
                    });
            };
            apps.makedir(dest, readdir);
        };
        util.file     = function biddle_copy_file(item, dest, prop) {
            var readStream  = node
                    .fs
                    .createReadStream(item),
                writeStream = node
                    .fs
                    .createWriteStream(dest, {
                        mode: prop.mode
                    }),
                errorflag   = false;
            readStream.on("error", function biddle_copy_file_readError(error) {
                errorflag = true;
                return util.eout(error, "biddle_copy_file_readError");
            });
            writeStream.on("error", function biddle_copy_file_writeError(error) {
                errorflag = true;
                return util.eout(error, "biddle_copy_file_writeError");
            });
            if (errorflag === true) {
                return;
            }
            writeStream
                .on("open", function biddle_copy_file_write() {
                    readStream.pipe(writeStream);
                });
            writeStream.once("finish", function biddle_copy_file_finish() {
                var filename = item.split(node.path.sep);
                node
                    .fs
                    .utimes(dest + node.path.sep + filename[filename.length - 1], prop.atime, prop.mtime, function biddle_copy_file_finish_utimes() {
                        util.complete(item);
                    });
            });
        };
        util.link     = function biddle_copy_link(item, dest) {
            node
                .fs
                .readlink(item, function biddle_copy_link_readlink(err, resolvedlink) {
                    if (err !== null) {
                        return util.eout(err, "biddle_copy_link_readlink");
                    }
                    resolvedlink = apps.relToAbs(resolvedlink, data.cwd);
                    node
                        .fs
                        .stat(resolvedlink, function biddle_copy_link_readlink_stat(ers, stats) {
                            var type = "file";
                            if (ers !== null) {
                                return util.eout(ers, "biddle_copy_link_readlink_stat");
                            }
                            if (stats === undefined || stats.isFile === undefined) {
                                return util.eout("Error in performing stat against " + item,
                                "biddle_copy_link_readlink_stat");
                            }
                            if (stats.isDirectory() === true) {
                                type = "junction";
                            }
                            node
                                .fs
                                .symlink(resolvedlink, dest, type, function biddle_copy_link_readlink_stat_makelink(erl) {
                                    if (erl !== null) {
                                        return util.eout(erl, "biddle_copy_link_readlink_stat_makelink");
                                    }
                                    util.complete(item);
                                });
                        });
                });
        };
        util.stat     = function biddle_copy_stat(item, dest) {
            var func     = (data.command === "copy")
                    ? "lstat"
                    : "stat",
                filename = item.split(node.path.sep),
                expath   = [],
                a        = 0,
                delay    = function biddle_copy_stat_statIt_delay() {
                    util.complete(item);
                };
            numb.start += 1;
            if (filename.length > 1 && filename[filename.length - 1] === "") {
                filename.pop();
            }
            dest = dest.replace(/((\/|\\)+)$/, "") + node.path.sep + filename[filename.length - 1];
            if (exlen > 0) {
                do {
                    if (dest.lastIndexOf(exclusions[a]) === dest.length - exclusions[a].length && dest.length - exclusions[a].length > 0) {
                        expath = exclusions[a].split(node.path.sep);
                        if (expath[expath.length - 1] === filename[filename.length - 1]) {
                            return setTimeout(delay, 20);
                        }
                    }
                    a += 1;
                } while (a < exlen);
            }
            node.fs[func](item,
            function biddle_copy_stat_statIt(er, stats) {
                var action = function biddle_copy_stat_statIt_action() {
                    if (stats.isFile() === true) {
                        numb.files += 1;
                        return util.file(item, dest, {
                            atime: (Date.parse(stats.atime) / 1000),
                            mode : stats.mode,
                            mtime: (Date.parse(stats.mtime) / 1000)
                        });
                    }
                    if (stats.isDirectory() === true) {
                        numb.dirs += 1;
                        return util.dir(item, dest);
                    }
                    if (stats.isSymbolicLink() === true) {
                        numb.link += 1;
                        return util.link(item, dest);
                    }
                    util.complete(item);
                };
                if (er !== null) {
                    return apps.errout({
                        error: er,
                        name : "biddle_copy_stat_statIt"
                    });
                }
                if (stats === undefined || stats.isFile === undefined) {
                    return apps.errout({
                        error: "Error in performing stat against " + item,
                        name : "biddle_copy_stat_statIt"
                    });
                }
                if (numb.start === 1 && stats.isDirectory() === false && data.command === "copy") {
                    expath = dest.split(node.path.sep);
                    expath.pop();
                    apps.makedir(expath.join(node.path.sep), function biddle_copy_stat_statIt_makedir() {
                        action();
                    });
                } else {
                    action();
                }
            });
        };
        util.stat(apps.relToAbs(target, data.cwd), apps.relToAbs(destination, data.cwd));
    };
    apps.errout      = function biddle_errout(errData) {
        var error = (typeof errData.error !== "string" || errData.error.toString().indexOf("Error: ") === 0)
                ? errData
                    .error
                    .toString()
                    .replace("Error: ", text.bold + text.red + "Error:" + text.none + " ")
                : text.bold + text.red + "Error:" + text.none + " " + errData
                    .error
                    .toString(),
            stack = new Error().stack;
        if (data.platform === "win32") {
            stack = stack.replace("Error", "Stack trace\r\n-----------");
        } else {
            stack = stack.replace("Error", "Stack trace\n-----------");
        }
        error = error
            .toString()
            .replace(/(\s+)$/, "");
        if (data.command === "test" && data.input[2] === "biddle") {
            if (errData.name.indexOf("biddle_test") === 0) {
                data.published.biddletesta = {
                    directory: data.abspath + "publications" + node.path.sep + "biddletesta"
                };
                data.installed.biddletesta = {
                    location: data.abspath + "applications" + node.path.sep + "biddletesta"
                };
                data.input[2]              = "biddletesta";
                apps.unpublish(true);
                apps.uninstall(true);
            }
            apps
                .rmrecurse(data.abspath + "unittest",
                function biddle_errout_dataClean() {
                    apps
                        .rmrecurse(data.abspath + "temp",
                        function biddle_errout_dataClean_tempTestClean() {
                            console.log(text.red + "Unit test failure." + text.nocolor);
                            if (errData.stdout !== undefined) {
                                console.log(errData.stdout);
                            }
                            console.log(text.bold + text.cyan + "Function:" + text.none + " " + errData.name);
                            console.log(error);
                            console.log("");
                            console.log(stack);
                            console.log("");
                            console.log(errData.time);
                            process.exit(1);
                        });
                });
        } else {
            apps
                .rmrecurse(data.abspath + "temp",
                function biddle_errout_dataClean_tempNontestClean() {
                    console.log(text.bold + text.cyan + "Function:" + text.none + " " + errData.name);
                    console.log(error);
                    if (data.childtest === false) {
                        console.log("");
                        console.log(stack);
                        console.log("");
                        console.log("Please report defects to https://github.com/prettydiff/biddle/issues");
                    }
                    process.exit(1);
                });
        }
    };
    apps.get         = function biddle_get(url, callback) {
        var a       = (typeof url === "string")
                ? url.indexOf("s://")
                : 0,
            zippy   = (data.command === "install" && (/(\.zip)$/).test(url) === true),
            addy    = (zippy === true)
                ? data.address.downloads
                : data.address.target,
            getcall = function biddle_get_getcall(res) {
                var file = [];
                res.on("data", function biddle_get_getcall_data(chunk) {
                    file.push(chunk);
                });
                res.on("end", function biddle_get_getcall_end() {
                    if (res.statusCode !== 200) {
                        console.log(res.statusCode + " " + node.http.STATUS_CODES[res.statusCode] + ", for request " + url);
                        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location !== undefined) {
                            data.input[2] = res.headers.location;
                            data.fileName = apps.getFileName();
                            biddle_get(res.headers.location, callback);
                        }
                    } else if ((data.command !== "install" && (/[\u0002-\u0008]|[\u000e-\u001f]/).test(file[0]) === true) || zippy === true) {
                        apps
                            .makedir(addy, function biddle_get_getcall_end_complete() {
                                apps.writeFile(Buffer.concat(file), addy + data.fileName, function biddle_get_getcall_end_complete_writeFile(data) {
                                    callback(data);
                                });
                            });
                    } else {
                        callback(file.join(""));
                    }
                });
                res.on("error", function biddle_get_getcall_error(error) {
                    return apps.errout({
                        error: error,
                        name : "biddle_get_getcall_error"
                    });
                });
            };
        if ((/^(https?:\/\/)/).test(url) === false) {
            if ((/(\.zip)$/).test(url) === true) {
                console.log("Address " + url + " is missing the " + text.cyan + "http(s)" + text.nocolor + " scheme, treating as a local path...");
                apps.makedir(addy, function biddle_get_localZip() {
                    apps.copy(data.input[2], "downloads", [], callback);
                });
            } else if (data.command === "status") {
                apps
                    .readBinary(url, function biddle_get_readLocal(filedata, filepath) {
                        callback(filedata, filepath);
                    });
            } else {
                apps
                    .readBinary(url, function biddle_get_readLocal(filedata) {
                        callback(filedata);
                    });
            }
        } else if (a > 0 && a < 10) {
            node
                .https
                .get(url, getcall);
        } else {
            node
                .http
                .get(url, getcall);
        }
    };
    apps.getFileName = function biddle_getFileName() {
        var paths  = [],
            output = "";
        if (data.input[2] === undefined) {
            return "download.xxx";
        }
        if ((/^(https?:\/\/)/).test(data.input[2]) === true) {
            output = data
                .input[2]
                .replace(/^(https?:\/\/)/, "");
            if (output.indexOf("?") > 0) {
                output = output.slice(0, output.indexOf("?"));
            }
            paths = output.split("/");
        } else {
            paths = data
                .input[2]
                .replace(/^(\/|\\)+/, "")
                .split(node.path.sep);
        }
        if (paths[paths.length - 1].length > 0) {
            output = paths[paths.length - 1].toLowerCase();
        } else {
            do {
                paths.pop();
            } while (paths.length > 0 && paths[paths.length - 1] === "");
            if (paths.length < 1) {
                return "download.xxx";
            }
            output = paths[paths.length - 1].toLowerCase();
        }
        return apps.sanitizef(output);
    };
    apps.getpjson    = function biddle_getpjson(callback) {
        var file = data
            .input[2]
            .replace(/(\/|\\)$/, "") + node.path.sep + "package.json";
        node
            .fs
            .readFile(file, "utf8", function biddle_getpjson_readfile(err, fileData) {
                if (err !== null && err !== undefined) {
                    if (err.toString().indexOf("no such file or directory") > 0) {
                        return apps.errout({
                            error: "The package.json file is missing from " + data.input[2] + ". biddle cannot publish without a package.json file. Perhaps " + apps.relToAbs(data.input[2], data.cwd) + " is the incorrect location.",
                            name : "biddle_getpjson_readFile"
                        });
                    }
                    return apps.errout({
                        error: err,
                        name : "biddle_getpjson_readFile"
                    });
                }
                data.packjson = JSON.parse(fileData);
                if (typeof data.packjson.name !== "string" || data.packjson.name.length < 1) {
                    return apps.errout({
                        error: "The package.json file is missing the required " + text.red + "name" + text.nocolor + " property.",
                        name : "biddle_getpjson_readfile"
                    });
                }
                if (typeof data.packjson.version !== "string" || data.packjson.version.length < 1) {
                    return apps.errout({
                        error: "The package.json file is missing the required " + text.red + "version" + text.nocolor + " proper" +
                                  "ty.",
                        name : "biddle_getpjson_readfile"
                    });
                }
                if (typeof data.packjson.name !== "string") {
                    if (typeof data.packjson.name === "object" && data.packjson.name !== null) {
                        data.packjson.name = JSON.stringify(data.packjson.name);
                    } else {
                        data.packjson.name = String(data.packjson.name);
                    }
                }
                if (typeof data.packjson.version !== "string") {
                    if (typeof data.packjson.version === "object" && data.packjson.version !== null) {
                        data.packjson.version = JSON.stringify(data.packjson.version);
                    } else {
                        data.packjson.version = String(data.packjson.version);
                    }
                }
                data.packjson.name = apps.sanitizef(data.packjson.name);
                callback();
            });
    };
    apps.global      = function biddle_global(loc) {
        var bin = loc + "bin";
        if (data.input[2] === undefined || data.input[2] === "") {
            data.input[2] = "biddle";
        } else if (data.input[2] === "remove") {
            data.input[2] = "biddle";
            data.input[3] = "remove";
        } else {
            if (data.installed[data.input[2]] === undefined && data.command === "global") {
                return apps.errout({
                    error: "Application " + data.input[2] + " is not installed by biddle. biddle will only add applications to the environmen" +
                            "tal path that it has installed.",
                    name : "biddle_global"
                });
            }
            bin = loc + "bin";
        }
        if (data.platform === "win32") {
            return node.child(cmds.pathRead(), function biddle_global_winRead(er, stdout, stder) {
                var remove = "";
                if (er !== null) {
                    return apps.errout({
                        error: er,
                        name : "biddle_global_winRead"
                    });
                }
                if (stder !== null && stder !== "") {
                    return apps.errout({
                        error: stder,
                        name : "biddle_global_winRead"
                    });
                }
                if (stdout.indexOf(bin) > -1) {
                    if (data.input[3] === "remove") {
                        remove = stdout
                            .replace(";" + loc + "cmd",
                        "")
                            .replace(/(\s+)$/, "");
                        return node.child(cmds.pathRemove(remove), function biddle_global_winRead_winRemovePath(erw, stdoutw, stderw) {
                            if (erw !== null) {
                                return apps.errout({
                                    error: erw,
                                    name : "biddle_global_winRead_winRemovePath"
                                });
                            }
                            if (stderw !== null && stderw !== "") {
                                return apps.errout({
                                    error: stderw,
                                    name : "biddle_global_winRead_winRemovePath"
                                });
                            }
                            if (data.command === "global") {
                                console.log(loc + "cmd removed from %PATH%.");
                            }
                            return stdoutw;
                        });
                    }
                    if (data.command === "global") {
                        return apps.errout({
                            error: loc + "cmd is already in %PATH%",
                            name : "biddle_global_winRead"
                        });
                    }
                }
                if (data.input[3] === "remove" && data.command === "global") {
                    return apps.errout({
                        error: loc + "cmd is not present in %PATH%",
                        name : "biddle_global_winRead"
                    });
                }
                node
                    .child(cmds.pathSet(loc), function biddle_global_winRead_winWritePath(erw, stdoutw, stderw) {
                        if (erw !== null) {
                            return apps.errout({
                                error: erw,
                                name : "biddle_global_winRead_winWritePath"
                            });
                        }
                        if (stderw !== null && stderw !== "") {
                            return apps.errout({
                                error: stderw,
                                name : "biddle_global_winRead_winWritePath"
                            });
                        }
                        if (data.command === "global") {
                            console.log(loc + "cmd added to %PATH%.");
                        }
                        return stdoutw;
                    });
            });
        }
        node
            .child("echo ~", function biddle_global_findHome(erh, stdouth, stderh) {
                var flag     = {
                        bash_profile: false,
                        profile     : false
                    },
                    terminal = function biddle_global_findHome_terminal() {
                        if (data.input[3] === "remove" && data.command === "global") {
                            return console.log(bin + " removed from $PATH but will remain available until the terminal is restarted.");
                        }
                        if (data.command === "global") {
                            console.log("Restart the terminal or execute:  export PATH=" + bin + ":$PATH");
                        }
                    },
                    readPath = function biddle_global_findHome_readPath(dotfile) {
                        node
                            .fs
                            .readFile(dotfile, "utf8", function biddle_global_findHome_readPath_nixRead(err, filedata) {
                                var pathStatement = "\nexport PATH=\"" + bin + ":$PATH\"\n";
                                if (err !== null && err !== undefined) {
                                    return apps.errout({
                                        error: err,
                                        name : "biddle_global_findHome_nixStat_nixRead"
                                    });
                                }
                                if (filedata.indexOf(bin) > -1) {
                                    if (data.input[3] === "remove") {
                                        return apps.writeFile(filedata.replace(pathStatement, ""), dotfile, function biddle_global_findHome_readPath_nixRead_nixRemove() {
                                            if (data.command === "global") {
                                                console.log("Path updated in " + dotfile);
                                            }
                                            if (dotfile.indexOf("bash_profile") > 0) {
                                                flag.bash_profile = true;
                                                if (flag.profile === true) {
                                                    terminal();
                                                }
                                            } else {
                                                flag.profile = true;
                                                if (flag.bash_profile === true) {
                                                    terminal();
                                                }
                                            }
                                        });
                                    }
                                    if (data.command === "global") {
                                        return apps.errout({
                                            error: bin + " is already in $PATH",
                                            name : "biddle_global_findHome_readPath_nixRead"
                                        });
                                    }
                                }
                                if (data.input[3] === "remove" && data.command !== "uninstall") {
                                    return apps.errout({
                                        error: bin + " is not present in $PATH",
                                        name : "biddle_global_findHome_readPath_nixRead"
                                    });
                                }
                                apps
                                    .writeFile(filedata + pathStatement,
                                    dotfile, function biddle_global_findHome_readPath_nixRead_nixRemove() {
                                        if (data.command === "global") {
                                            console.log("Path updated in " + dotfile);
                                        }
                                        if (dotfile.indexOf("bash_profile") > 0) {
                                            flag.bash_profile = true;
                                            if (flag.profile === true) {
                                                terminal();
                                            }
                                        } else {
                                            flag.profile = true;
                                            if (flag.bash_profile === true) {
                                                terminal();
                                            }
                                        }
                                    });
                            });
                    };
                if (erh !== null) {
                    return apps.errout({
                        error: erh,
                        name : "biddle_global_findHome"
                    });
                }
                if (stderh !== null && stderh !== "") {
                    return apps.errout({
                        error: stderh,
                        name : "biddle_global_findHome"
                    });
                }
                stdouth = stdouth.replace(/\s+/g, "") + "/.";
                node
                    .fs
                    .stat(stdouth + "profile",
                    function biddle_cmds_global_findHome_nixStatProfile(er) {
                        if (er !== null) {
                            if (er.toString().indexOf("no such file or directory") > 1) {
                                flag.profile = true;
                                if (flag.bash_profile === true) {
                                    terminal();
                                }
                            } else {
                                return apps.errout({
                                    error: er,
                                    name : "biddle_cmds_global_findHome_nixStatProfile"
                                });
                            }
                        } else {
                            readPath(stdouth + "profile");
                        }
                    });
                node
                    .fs
                    .stat(stdouth + "bash_profile",
                    function biddle_cmds_global_findHome_nixStatBash(er) {
                        if (er !== null) {
                            if (er.toString().indexOf("no such file or directory") > 1) {
                                flag.bash_profile = true;
                                if (flag.profile === true) {
                                    terminal();
                                }
                            } else {
                                return apps.errout({
                                    error: er,
                                    name : "biddle_cmds_global_findHome_nixStatBash"
                                });
                            }
                        } else {
                            readPath(stdouth + "bash_profile");
                        }
                    });
            });
    };
    apps.hash        = function biddle_hash(filepath, store, callback) {
        var hash = node.crypto.createHash("sha512");
        if (filepath === "string" && data.input[3] !== undefined) {
            hash.update(data.input[3]);
            console.log(hash.digest("hex"));
        } else {
            node
                .fs
                .stat(filepath, function biddle_hash_stat(er, stat) {
                    if (er !== null) {
                        if (er.toString().indexOf("no such file or directory") > 0) {
                            if (data.command === "install") {
                                return apps.errout({
                                    error: filepath + " " + text.red + "does not appear to be a zip file" + text.nocolor + ". Install command expects t" +
                                            "o receive a zip file and a hash file at the same location and file name.",
                                    name : "biddle_hash_stat"
                                });
                            }
                            return apps.errout({
                                error: "filepath " + filepath + " is not a file.",
                                name : "biddle_hash_stat"
                            });
                        }
                        return apps.errout({
                            error: er,
                            name : "biddle_hash_stat"
                        });
                    }
                    if (stat === undefined || stat.isFile() === false) {
                        if (data.command === "install") {
                            return apps.errout({
                                error: filepath + " " + text.red + "does not appear to be a zip file" + text.nocolor + ". Install command expects t" +
                                        "o receive a zip file and a hash file at the same location and file name.",
                                name : "biddle_hash_stat"
                            });
                        }
                        return apps.errout({
                            error: "filepath " + filepath + " is not a file.",
                            name : "biddle_hash_stat"
                        });
                    }
                    node.fs.open(filepath, "r", function biddle_hash_stat_open(ero, fd) {
                        var msize = (stat.size < 100)
                                ? stat.size
                                : 100,
                            buff  = new Buffer(msize);
                        if (ero !== null) {
                            return apps.errout({error: ero, name: "biddle_hash_stat_open"});
                        }
                        node.fs.read(fd, buff, 0, msize, 1, function biddle_hash_stat_open_read(erra, bytesa, buffera) {
                            var bstring  = "",
                                hashExec = function biddle_hash_stat_open_read_hashExec(filedump) {
                                    hash.on("readable", function biddle_hash_stat_open_read_readBinary_hash() {
                                        var hashdata = hash.read(),
                                            hashstr  = "";
                                        if (hashdata !== null) {
                                            hashstr = hashdata.toString("hex").replace(/\s+/g, "");
                                            data[store] = hashstr;
                                            callback(hashstr);
                                        }
                                    });
                                    hash.write(filedump);
                                    hash.end();
                                };
                            if (erra !== null) {
                                return apps.errout({error: erra, name: "biddle_hash_stat_open_read"});
                            }
                            bstring = buffera.toString("utf8", 0, buffera.length);
                            bstring = bstring.slice(2, bstring.length - 2);
                            if ((/[\u0002-\u0008]|[\u000e-\u001f]/).test(bstring) === true) {
                                buff = new Buffer(stat.size);
                                node.fs.read(fd, buff, 0, stat.size, 0, function biddle_hash_stat_open_read_readBinary(errb, bytesb, bufferb) {
                                    if (errb !== null) {
                                        return apps.errout({error: errb, name: "biddle_hash_stat_open_read_readBinary"});
                                    }
                                    if (bytesb > 0) {
                                        hashExec(bufferb);
                                    }
                                });
                            } else {
                                node.fs.readFile(filepath, {encoding: "utf8"}, function biddle_hash_stat_open_read_readFile(errc, dump) {
                                    if (errc !== null && errc !== undefined) {
                                        return apps.errout({error: errc, name: "biddle_hash_stat_open_read_readFile"});
                                    }
                                    hashExec(dump);
                                });
                            }
                            return bytesa;
                        });
                    });
                });
        }
    };
    apps.install     = function biddle_install() {
        var flag        = {
                hash: false,
                late: false,
                zip : false
            },
            late        = (function biddle_install_late() {
                var sep  = ((/^(https?:\/\/)/).test(data.input[2]) === true)
                        ? "/"
                        : node.path.sep,
                    dirs = data
                        .input[2]
                        .split(sep);
                data.fileName = dirs.pop();
                return dirs.join(sep) + sep + "latest.txt";
            }()),
            compareHash = function biddle_install_compareHash() {
                apps
                    .hash(data.address.downloads + data.fileName, "hashZip", function biddle_install_compareHash_hash() {
                        if (data.hashFile === data.hashZip) {
                            var location = "",
                                puba     = [],
                                pubs     = "";
                            if ((/^(https?:\/\/)/i).test(data.input[2]) === true) {
                                location = data.address.downloads + data.input[2].split("/").pop();
                                puba     = data.input[2].split("/");
                                puba.pop();
                                pubs     = puba.join("/");
                            } else {
                                location = apps.relToAbs(data.input[2], data.cwd);
                                pubs     = apps.relToAbs(data.input[2].slice(0, data.input[2].lastIndexOf(node.path.sep) + 1), data.cwd);
                            }
                            apps
                                .zip(function biddle_install_callback() {
                                    var status   = {
                                            packjson: false,
                                            remove  : false
                                        },
                                        complete = function biddle_install_compareHash_hash_complete() {
                                            console.log("Application " + text.cyan + data.packjson.name + text.nocolor + "m is installed to version: " + data.packjson.version);
                                        };
                                    data.installed[data.packjson.name]           = {};
                                    data.installed[data.packjson.name].location  = data.address.target;
                                    data.installed[data.packjson.name].version   = data.packjson.version;
                                    data.installed[data.packjson.name].published = pubs;
                                    apps.writeFile(JSON.stringify(data.installed), data.abspath + "installed.json",
                                    function biddle_install_compareHash_hash_installedJSON() {
                                        status.packjson = true;
                                        if (status.remove === true) {
                                            complete();
                                        }
                                    });
                                    apps.rmrecurse(data.abspath + "downloads" + node.path.sep + data.fileName, function biddle_install_compareHash_hash_remove() {
                                        status.remove = true;
                                        if (status.packjson === true) {
                                            complete();
                                        }
                                    });
                                }, {
                                    location: location,
                                    name    : ""
                                });
                        } else {
                            return apps.errout({error: text.red + "Hashes don't match" + text.nocolor + " for " + data.input[2] + ". File is saved in the downloads directory and will not be installed.\r\nGenerated hash - " + data.hashZip + "\r\nRequested hash - " + data.hashFile, name: "biddle_install_compareHash"});
                        }
                    });
            };
        apps.get(data.input[2], function biddle_install_getzip() {
            flag.zip = true;
            if (flag.hash === true && flag.late === true) {
                compareHash();
            }
        });
        apps.get(data.input[2].replace(".zip", ".hash"), function biddle_install_gethash(fileData) {
            flag.hash = true;
            data.hashFile = fileData;
            if (flag.zip === true && flag.late === true) {
                compareHash();
            }
        });
        apps.get(late, function biddle_install_getlate(fileData) {
            var dirs = data
                    .address
                    .target
                    .split(node.path.sep),
                name = "";
            if (dirs[dirs.length - 1] === "") {
                dirs.pop();
            }
            name = dirs[dirs.length - 1];
            if (typeof data.installed[name] === "object" && data.installed[name].version === fileData) {
                return apps.errout({
                    error: "This application is already installed at version " + text.cyan + fileData + text.nocolor + ". To continue uninstall the application and try again: " + text.green + "biddl" +
                            "e uninstall " + name + text.nocolor,
                    name : "biddle_install_getlate"
                });
            }
            flag.late = true;
            if (flag.zip === true && flag.hash === true) {
                compareHash(fileData);
            }
        });
    };
    apps.list        = function biddle_list() {
        var listtype = {
                installed: Object.keys(data.installed),
                published: Object.keys(data.published)
            },
            dolist   = function biddle_list_dolist(type) {
                var len    = 0,
                    a      = 0,
                    proper = (type === "published")
                        ? "Published"
                        : "Installed",
                    vert   = (type === "published")
                        ? "latest"
                        : "version",
                    loct   = (type === "published")
                        ? "directory"
                        : "location",
                    pads   = {},
                    pad    = function biddle_list_dolist_pad(item, col) {
                        var b = item.length;
                        if (b === pads[col]) {
                            return item;
                        }
                        do {
                            item = item + " ";
                            b    += 1;
                        } while (b < pads[col]);
                        return item;
                    };
                listtype[type].sort();
                if (listtype[type].length === 0) {
                    console.log(text.underline + proper + " applications:" + text.normal);
                    console.log("");
                    console.log("No applications are " + type + " by biddle.");
                    console.log("");
                } else {
                    console.log(text.underline + proper + " applications:" + text.normal);
                    console.log("");
                    len          = listtype[type].length;
                    pads.name    = 0;
                    pads.version = 0;
                    a            = 0;
                    do {
                        if (listtype[type][a].length > pads.name) {
                            pads.name = listtype[type][a].length;
                        }
                        if (data[type][listtype[type][a]][vert].length > pads.version) {
                            pads.version = data[type][listtype[type][a]][vert].length;
                        }
                        a += 1;
                    } while (a < len);
                    a = 0;
                    do {
                        console.log("* " + text.cyan + pad(listtype[type][a], "name") + text.nocolor + " - " + pad(data[type][listtype[type][a]][vert], "version") + " - " + data[type][listtype[type][a]][loct]);
                        a += 1;
                    } while (a < len);
                    console.log("");
                }
            };
        if (data.input[2] !== "installed" && data.input[2] !== "published" && data.input[2] !== undefined) {
            data.input[2] = "both";
        }
        if (data.input[2] === "installed" || data.input[2] === "both" || data.input[2] === undefined) {
            dolist("installed");
        }
        if (data.input[2] === "published" || data.input[2] === "both" || data.input[2] === undefined) {
            dolist("published");
        }
    };
    apps.makedir     = function biddle_makedir(dirToMake, callback) {
        node
            .fs
            .stat(dirToMake, function biddle_makedir_stat(err, stats) {
                var dirs   = [],
                    ind    = 0,
                    len    = 0,
                    restat = function biddle_makedir_stat_restat() {
                        node
                            .fs
                            .stat(dirs.slice(0, ind + 1).join(node.path.sep), function biddle_makedir_stat_restat_callback(erra, stata) {
                                ind += 1;
                                if ((erra !== null && erra.toString().indexOf("no such file or directory") > 0) || (typeof erra === "object" && erra !== null && erra.code === "ENOENT")) {
                                    return node
                                        .fs
                                        .mkdir(dirs.slice(0, ind).join(node.path.sep), function biddle_makedir_stat_restat_callback_mkdir(errb) {
                                            if (errb !== null && errb.toString().indexOf("file already exists") < 0) {
                                                return apps.errout({
                                                    error: errb,
                                                    name : "biddle_makedir_stat_restat_callback_mkdir"
                                                });
                                            }
                                            if (ind < len) {
                                                biddle_makedir_stat_restat();
                                            } else {
                                                callback();
                                            }
                                        });
                                }
                                if (erra !== null && erra.toString().indexOf("file already exists") < 0) {
                                    return apps.errout({
                                        error: erra,
                                        name : "biddle_makedir_stat_restat_callback"
                                    });
                                }
                                if (stata.isFile() === true) {
                                    return apps.errout({
                                        error: "Destination directory, '" + dirToMake + "', is a file.",
                                        name : "biddle_makedir_stat_restat_callback"
                                    });
                                }
                                if (ind < len) {
                                    biddle_makedir_stat_restat();
                                } else {
                                    callback();
                                }
                            });
                    };
                if ((err !== null && err.toString().indexOf("no such file or directory") > 0) || (typeof err === "object" && err !== null && err.code === "ENOENT")) {
                    dirs = dirToMake.split(node.path.sep);
                    if (dirs[0] === "") {
                        ind += 1;
                    }
                    len = dirs.length;
                    return restat();
                }
                if (err !== null && err.toString().indexOf("file already exists") < 0) {
                    return apps.errout({
                        error: err,
                        name : "biddle_makedir_stat"
                    });
                }
                if (stats.isFile() === true) {
                    return apps.errout({
                        error: "Destination directory, '" + dirToMake + "', is a file.",
                        name : "biddle_makedir_stat"
                    });
                }
                callback();
            });
    };
    apps.markdown    = function biddle_markdown() {
        var file = data.abspath + "readme.md",
            size = data.input[2];
        if (data.command === "markdown") {
            file = data.input[2];
            size = data.input[3];
        }
        node
            .fs
            .readFile(file, "utf8", function biddle_markdown_readme(err, readme) {
                var lines  = [],
                    listly = [],
                    output = [],
                    ind    = "",
                    listr  = "",
                    b      = 0,
                    len    = 0,
                    bullet = "",
                    parse  = function biddle_markdown_readme_parse(item, listitem, cell) {
                        var block = false,
                            chars = [],
                            final = 0,
                            s     = (/\s/),
                            x     = 0,
                            y     = ind.length,
                            start = 0,
                            index = 0,
                            math  = 0,
                            endln = 0,
                            quote = "",
                            wrap  = function biddle_markdown_readme_parse_wrap(tick) {
                                var z      = x,
                                    format = function biddle_markdown_readme_parse_wrap_format(eol) {
                                        if (block === true) {
                                            chars[eol] = "\n" + ind + "| ";
                                        } else {
                                            chars[eol] = "\n" + ind;
                                        }
                                        index = 1 + y + eol;
                                        if (chars[eol - 1] === " ") {
                                            chars[eol - 1] = "";
                                        } else if (chars[eol + 1] === " ") {
                                            chars.splice(eol + 1,
                                            1);
                                            final -= 1;
                                        }
                                    };
                                if (cell === true) {
                                    return;
                                }
                                if (tick === true) {
                                    do {
                                        z -= 1;
                                    } while (chars[z + 1].indexOf(text.green) < 0 && z > index);
                                    if (z > index) {
                                        format(z);
                                    }
                                } else if (s.test(chars[x]) === true) {
                                    format(x);
                                } else {
                                    do {
                                        z -= 1;
                                    } while (s.test(chars[z]) === false && z > index);
                                    if (z > index) {
                                        format(z);
                                    }
                                }
                            };
                        if ((/\u0020{4}\S/).test(item) === true && listitem === false) {
                            item = text.green + item + text.nocolor;
                            return item;
                        }
                        if (item.charAt(0) === ">") {
                            block = true;
                        }
                        if (listitem === true) {
                            item = item.replace(/^\s+/, "");
                        }
                        chars = item
                            .replace(/^(\s*>\s*)/, ind + "| ")
                            .replace(/`/g, "bix~")
                            .split("");
                        final = chars.length;
                        if (cell === true) {
                            start = 0;
                        } else {
                            if (block === true) {
                                chars.splice(0, 0, "  ");
                            }
                            if (listitem === true || block === true) {
                                x = listly.length;
                                do {
                                    x   -= 1;
                                    y   += 2;
                                    ind = ind + "  ";
                                } while (x > 0);
                            }
                            if (block === false) {
                                if (listitem === true) {
                                    chars.splice(0, 0, ind.slice(2));
                                } else {
                                    chars.splice(0, 0, ind);
                                }
                            }
                            start = y - 1;
                        }
                        endln = (isNaN(size) === false && size !== "")
                            ? Number(size) - y
                            : 100 - y;
                        for (x = start; x < final; x += 1) {
                            math = ((x + y) - (index - 1)) / endln;
                            if (quote === "") {
                                if (chars[x] === "*" && chars[x + 1] === "*") {
                                    quote = "**";
                                    chars.splice(x, 2);
                                    chars[x] = text.bold + chars[x];
                                    final    -= 2;
                                } else if (chars[x] === "_" && chars[x + 1] === "_") {
                                    quote = "__";
                                    chars.splice(x, 2);
                                    chars[x] = text.bold + chars[x];
                                    final    -= 2;
                                } else if (chars[x] === "*" && ((x === start && chars[x + 1] !== " ") || x > start)) {
                                    quote = "*";
                                    chars.splice(x, 1);
                                    chars[x] = text.yellow + chars[x];
                                    final    -= 1;
                                } else if (chars[x] === "_" && ((x === start && chars[x + 1] !== " ") || x > start)) {
                                    quote = "_";
                                    chars.splice(x, 1);
                                    chars[x] = text.yellow + chars[x];
                                    final    -= 1;
                                } else if (chars[x] === "b" && chars[x + 1] === "i" && chars[x + 2] === "x" && chars[x + 3] === "~") {
                                    quote = "`";
                                    chars.splice(x, 4);
                                    chars[x] = text.green + chars[x];
                                    final    -= 4;
                                } else if (chars[x - 2] === "," && chars[x - 1] === " " && chars[x] === "(") {
                                    quote    = ")";
                                    chars[x] = chars[x] + text.cyan;
                                }
                            } else if (chars[x] === "b" && chars[x + 1] === "i" && chars[x + 2] === "x" && chars[x + 3] === "~" && quote === "`") {
                                quote = "";
                                chars.splice(x, 4);
                                if (chars[x] === undefined) {
                                    x = chars.length - 1;
                                }
                                chars[x] = chars[x] + text.nocolor;
                                final    -= 4;
                                if (math > 1 && chars[x + 1] === " ") {
                                    x += 1;
                                    wrap(false);
                                }
                            } else if (chars[x] === ")" && quote === ")") {
                                quote    = "";
                                chars[x] = text.nocolor + chars[x];
                                if (math > 1 && chars[x + 1] === " ") {
                                    x += 1;
                                    wrap(false);
                                }
                            } else if (chars[x] === "*" && chars[x + 1] === "*" && quote === "**") {
                                quote = "";
                                chars.splice(x, 2);
                                chars[x - 1] = chars[x - 1] + text.normal;
                                final        -= 2;
                            } else if (chars[x] === "*" && quote === "*") {
                                quote = "";
                                chars.splice(x, 1);
                                chars[x - 1] = chars[x - 1] + text.nocolor;
                                final        -= 1;
                            } else if (chars[x] === "_" && chars[x + 1] === "_" && quote === "__") {
                                quote = "";
                                chars.splice(x, 2);
                                chars[x - 1] = chars[x - 1] + text.normal;
                                final        -= 2;
                            } else if (chars[x] === "_" && quote === "_") {
                                quote = "";
                                chars.splice(x, 1);
                                chars[x - 1] = chars[x - 1] + text.nocolor;
                                final        -= 1;
                            }
                            if (math > 1) {
                                if (quote === "`") {
                                    wrap(true);
                                } else {
                                    wrap(false);
                                }
                            }
                            if (chars[x + 1] === undefined) {
                                break;
                            }
                        }
                        if (quote === "**") {
                            chars.pop();
                            chars[x - 1] = chars[x - 1] + text.normal;
                        } else if (quote === "*") {
                            chars.pop();
                            chars[x - 1] = chars[x - 1] + text.none;
                        } else if (quote === ")") {
                            chars[x - 1] = chars[x - 1] + text.nocolor;
                        } else if (quote === "`") {
                            chars.pop();
                            chars[x - 4] = chars[x - 4] + text.nocolor;
                            chars[x - 3] = "";
                            chars[x - 2] = "";
                            chars[x - 1] = "";
                            chars[x]     = "";
                        }
                        item = chars.join("");
                        if (block === true) {
                            ind = ind.slice(2);
                        } else if (listitem === true) {
                            ind = ind.slice(listly.length * 2);
                        }
                        return item;
                    },
                    table  = function biddle_markdown_readme_table() {
                        var rows = [
                                lines[b]
                                    .replace(/^\|/, "")
                                    .replace(/\|$/, "")
                                    .split("|")
                            ],
                            lens = rows[0].length,
                            cols = [],
                            c    = 0,
                            d    = 0,
                            e    = 0,
                            lend = 0,
                            line = "";
                        c    = b + 2;
                        line = lines[c]
                            .replace(/^\|/, "")
                            .replace(/\|$/, "");
                        d    = 0;
                        do {
                            rows[0][d] = parse(rows[0][d].replace(/\s+/g, " ").replace(/^\s/, "").replace(/\s$/, ""), false, true);
                            lend         = rows[0][d]
                                .replace(/\u001b\[\d+m/g, "")
                                .length;
                            cols.push(lend);
                            d += 1;
                        } while (d < lens);
                        if (line.indexOf("|") > -1) {
                            do {
                                rows.push(line.split("|").slice(0, lens));
                                d = 0;
                                do {
                                    rows[rows.length - 1][d] = parse(rows[rows.length - 1][d].replace(/\s+/g, " ").replace(/^\s/, "").replace(/\s$/, ""), false, true);
                                    lend                       = rows[rows.length - 1][d]
                                        .replace(/\u001b\[\d+m/g, "")
                                        .length;
                                    if (lend > cols[d]) {
                                        cols[d] = lend;
                                    }
                                    if (rows[rows.length - 1][d] === "\u2713") {
                                        rows[rows.length - 1][d] = text.bold + text.green + "\u2713" + text.none;
                                    } else if (rows[rows.length - 1][d] === "X") {
                                        rows[rows.length - 1][d] = text.bold + text.red + "X" + text.none;
                                    } else if (rows[rows.length - 1][d] === "?") {
                                        rows[rows.length - 1][d] = text.bold + text.yellow + "?" + text.none;
                                    }
                                    d += 1;
                                } while (d < lens);
                                c += 1;
                                if (c === len) {
                                    break;
                                }
                                line = lines[c]
                                    .replace(/^\|/, "")
                                    .replace(/\|$/, "");
                            } while (line.indexOf("|") > -1);
                        }
                        c    = 0;
                        lend = rows.length;
                        do {
                            d = 0;
                            do {
                                e = rows[c][d]
                                    .replace(/\u001b\[\d+m/g, "")
                                    .length;
                                if (d === lens - 1 && rows[c][d].length < cols[d]) {
                                    do {
                                        e          += 1;
                                        rows[c][d] = rows[c][d] + " ";
                                    } while (e < cols[d]);
                                } else {
                                    do {
                                        e          += 1;
                                        rows[c][d] = rows[c][d] + " ";
                                    } while (e < cols[d] + 1);
                                }
                                if (c === 0) {
                                    if (d > 0) {
                                        rows[c][d] = text.underline + " " + rows[c][d] + text.normal;
                                    } else {
                                        rows[c][d] = ind + text.underline + rows[c][d] + text.normal;
                                    }
                                } else {
                                    if (d > 0) {
                                        rows[c][d] = " " + rows[c][d];
                                    } else {
                                        rows[c][d] = ind + rows[c][d];
                                    }
                                }
                                d += 1;
                            } while (d < lens);
                            output.push(rows[c].join(""));
                            c += 1;
                            b += 1;
                        } while (c < lend);
                        b += 1;
                    };
                if (err !== null && err !== undefined) {
                    return apps.errout({
                        error: err,
                        name : "biddle_markdown_readme"
                    });
                }
                readme = (function biddle_markdown_readme_removeImages() {
                    var readout = [],
                        j       = readme.split(""),
                        i       = 0,
                        ilen    = j.length,
                        brace   = "",
                        code    = (j[0] === " " && j[1] === " " && j[2] === " " && j[3] === " ");
                    for (i = 0; i < ilen; i += 1) {
                        if (brace === "") {
                            if (j[i] === "\r") {
                                if (j[i + 1] === "\n") {
                                    j[i] = "";
                                } else {
                                    j[i] = "\n";
                                }
                                if (j[i + 1] === " " && j[i + 2] === " " && j[i + 3] === " " && j[i + 4] === " ") {
                                    code = true;
                                } else {
                                    code = false;
                                }
                            } else if (j[i] === "\n") {
                                if (j[i + 1] === " " && j[i + 2] === " " && j[i + 3] === " " && j[i + 4] === " ") {
                                    code = true;
                                } else {
                                    code = false;
                                }
                            } else if (j[i] === "`") {
                                brace = "`";
                                code  = true;
                            } else if (j[i] === "!" && j[i + 1] === "[") {
                                brace    = "]";
                                j[i]     = "";
                                j[i + 1] = "";
                            } else if (j[i] === "]" && j[i + 1] === "(") {
                                j[i] = ", ";
                            } else if (j[i] === "[" && code === false) {
                                j[i] = "";
                            } else if (j[i] === ")" && j[i + 1] === " " && (/\s/).test(j[i + 2]) === false) {
                                j[i] = "),";
                            }
                        } else if (brace === j[i]) {
                            if (brace === "`") {
                                code = false;
                            } else {
                                j[i] = "";
                            }
                            if (brace === "]" && j[i + 1] === "(") {
                                brace = ")";
                            } else {
                                brace = "";
                            }
                        }
                        if (brace !== ")") {
                            readout.push(j[i]);
                        }
                    }
                    return readout.join("");
                }());
                lines  = readme.split("\n");
                len    = lines.length;
                output.push("");
                for (b = 0; b < len; b += 1) {
                    if (lines[b].slice(1).indexOf("|") > -1 && (/---+\|---+/).test(lines[b + 1]) === true) {
                        table();
                    } else if (lines[b].indexOf("#### ") === 0) {
                        listly   = [];
                        ind      = "    ";
                        lines[b] = ind + text.underline + text.bold + text.yellow + lines[b].slice(5) + text.none;
                        ind      = "      ";
                    } else if (lines[b].indexOf("### ") === 0) {
                        listly   = [];
                        ind      = "  ";
                        lines[b] = ind + text.underline + text.bold + text.green + lines[b].slice(4) + text.none;
                        ind      = "    ";
                    } else if (lines[b].indexOf("## ") === 0) {
                        listly   = [];
                        ind      = "  ";
                        lines[b] = text.underline + text.bold + text.cyan + lines[b].slice(3) + text.none;
                    } else if (lines[b].indexOf("# ") === 0) {
                        listly   = [];
                        ind      = "";
                        lines[b] = text.underline + text.bold + text.red + lines[b].slice(2) + text.none;
                    } else if ((/^(\s*(\*|-)\s)/).test(lines[b]) === true) {
                        listr = (/^(\s*)/).exec(lines[b])[0];
                        if (listly.length === 0 || listly[listly.length - 1] < listr.length) {
                            if ((/\s/).test(listr.charAt(0)) === true) {
                                listly.push(listr.length);
                            } else {
                                listly = [listr.length];
                            }
                        } else if (listly.length > 1 && listr.length < listly[listly.length - 1]) {
                            do {
                                listly.pop();
                            } while (listly.length > 1 && listr.length < listly[listly.length - 1]);
                        }
                        if (listly.length % 2 > 0) {
                            bullet = "*";
                        } else {
                            bullet = "-";
                        }
                        lines[b] = parse(lines[b], true, false).replace(/\*|-/, text.bold + text.red + bullet + text.none);
                    } else if ((/^\s*>/).test(lines[b]) === true) {
                        listly   = [];
                        lines[b] = parse(lines[b], false, false);
                        if (b < len - 1 && (/^(\s*)$/).test(lines[b + 1]) === false) {
                            lines[b + 1] = ">" + lines[b + 1];
                        }
                    } else {
                        listly = [];
                        if (lines[b].length > 0) {
                            lines[b] = parse(lines[b], false, false);
                        }
                    }
                    output.push(lines[b]);
                }
                if (data.platform === "win32") {
                    ind = output.join("\r\n");
                } else {
                    ind = output.join("\n");
                }
                if ((data.command === "help" && data.input[3] === "test") || (data.command === "markdown" && data.input[4] === "test")) {
                    ind = "\"" + ind
                        .replace(/\r\n/g, "\n")
                        .slice(0, 8192)
                        .replace(/(\\(\w+)?)$/, "")
                        .replace(/\\(?!(\\))/g, "\\\\")
                        .replace(/\n/g, "\\n")
                        .replace(/"/g, "\\\"")
                        .replace(/\\\\"/g, "\\\"")
                        .replace(/(\s+)$/, "")
                        .replace(/(\\n)$/, "")
                        .replace(/\u001b\[39m\u001b\[0m/g, "\" + text.none + \"")
                        .replace(/\u001b\[0m/g, "\" + text.normal + \"")
                        .replace(/\u001b\[1m/g, "\" + text.bold + \"")
                        .replace(/\u001b\[4m/g, "\" + text.underline + \"")
                        .replace(/\u001b\[31m/g, "\" + text.red + \"")
                        .replace(/\u001b\[32m/g, "\" + text.green + \"")
                        .replace(/\u001b\[33m/g, "\" + text.yellow + \"")
                        .replace(/\u001b\[34m/g, "\" + text.blue + \"")
                        .replace(/\u001b\[35m/g, "\" + text.purple + \"")
                        .replace(/\u001b\[36m/g, "\" + text.cyan + \"")
                        .replace(/\u001b\[39m/g, "\" + text.nocolor + \"")
                        .replace(/\u0020\+\u0020""\u0020\+\u0020/g, " + ") + "\"";
                }
                console.log(ind);
                process.exit(0);
            });
    };
    apps.publish     = function biddle_publish() {
        var filedata  = [],
            varlen    = 0,
            varcount  = 0,
            publoc    = "",
            indexfile = function biddle_publish_indexfile() {
                var rows   = [],
                    file   = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?><!DOCTYPE html PUBLIC \"-//W3C//DTD X" +
                            "HTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\"><html xml:lang=" +
                            "\"en\" xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>!!app name!! - Public" +
                            "ations</title> <meta content=\"application/xhtml+xml;charset=UTF-8\" http-equiv=" +
                            "\"Content-Type\"/> <meta content=\"text/css\" http-equiv=\"content-style-type\"/" +
                            "> <meta content=\"application/javascript\" http-equiv=\"content-script-type\"/> " +
                            "<meta content=\"Global\" name=\"distribution\"/> <meta content=\"width=device-wi" +
                            "dth, initial-scale=1\" name=\"viewport\"/> <meta content=\"index, follow\" name=" +
                            "\"robots\"/> <style type=\"text/css\">body{background:#e8ddd8;font-family:\"Cent" +
                            "ury Gothic\",\"Trebuchet MS\";font-size:10px;margin:0;padding:1em}table{border-c" +
                            "ollapse:collapse}td,th{border:#333 solid 0.09em;font-size:1.6em;padding:0.5em 1e" +
                            "m}h1{background:#fff8e8;border:0.05em solid #321;display:inline-block;margin:0;p" +
                            "adding:0.2em}p{font-size:1.6em}tfoot td{font-size:1.2em;text-align:right}tfoot,t" +
                            "head{background:#e8e8e8}thead th{cursor:pointer;height:1.5em;text-align:center;v" +
                            "ertical-align:baseline}tbody tr:hover{background:#dfd}tr.odd{background:#e8e8ff}" +
                            "tr.even{background:#fff}.sort{float:left;margin:0 0.5em 0 -0.5em;width:1em}td[da" +
                            "ta-size]{text-align:right}</style></head><body><h1>!!app name!! - Publications</" +
                            "h1><p>Click on table headings to sort.</p><table><thead><tr><th><span aria-descr" +
                            "ibedby=\"aria-arrow\" class=\"sort\" style=\"visibility:hidden;\">&#x25bc;</span" +
                            "> Version</th><th><span aria-describedby=\"aria-arrow\" class=\"sort\" style=\"v" +
                            "isibility:hidden;\">&#x25bc;</span> Date</th><th><span aria-describedby=\"aria-a" +
                            "rrow\" class=\"sort\" style=\"visibility:hidden;\">&#x25bc;</span> Size</th><th>" +
                            "<span aria-describedby=\"aria-arrow\" class=\"sort\" style=\"visibility:hidden;" +
                            "\">&#x25bc;</span> Variant Name</th><th><span aria-describedby=\"aria-arrow\" cl" +
                            "ass=\"sort\" style=\"visibility:hidden;\">&#x25bc;</span> Zip File</th></tr></th" +
                            "ead><tbody>!!row!!</tbody><tfoot><tr><td colspan=\"5\">Published with <a href=\"" +
                            "https://github.com/prettydiff/biddle\">biddle</a>.</td></tr></tfoot></table><p a" +
                            "ria-hidden=\"true\" id=\"aria-arrow\" style=\"display:none;\"></p><script src=\"" +
                            "biddlesort.js\" type=\"application/javascript\"></script></body></html>",
                    script = "(function(){var headings=document.getElementsByTagName(\"thead\")[0].getElements" +
                            "ByTagName(\"th\"),hlen=headings.length,a=0,start=1,sorter=function(heading){var " +
                            "b=0,ind=0,len=headings.length,span=\"\",rows=[],rowlist=[],tbody=document.getEle" +
                            "mentsByTagName(\"tbody\")[0],ascend=false,rowsort=function(a,b){var vala=\"\",va" +
                            "lb=\"\";if(ind===1){vala=Number(a.getElementsByTagName(\"td\")[1].getAttribute(" +
                            "\"data-date\"));valb=Number(b.getElementsByTagName(\"td\")[1].getAttribute(\"dat" +
                            "a-date\"))}else if(ind===2){vala=Number(a.getElementsByTagName(\"td\")[2].getAtt" +
                            "ribute(\"data-size\"));valb=Number(b.getElementsByTagName(\"td\")[2].getAttribut" +
                            "e(\"data-size\"))}else{vala=a.getElementsByTagName(\"td\")[ind].innerHTML.toLowe" +
                            "rCase();valb=b.getElementsByTagName(\"td\")[ind].innerHTML.toLowerCase()}if(asce" +
                            "nd===true){if(vala>valb){return 1}else{return -1}}else{if(vala>valb){return -1}e" +
                            "lse{return 1}}};do{span=headings[b].getElementsByTagName(\"span\")[0];if(heading" +
                            "===headings[b]){ind=b;if(span.style.visibility===\"visible\"){if(span.innerHTML=" +
                            "==\"▲\"){span.innerHTML=\"▼\"}else{span.innerHTML=\"▲\"}}else{span.style.visibil" +
                            "ity=\"visible\"}if(span.innerHTML===\"▲\"){ascend=true;document.getElementById(" +
                            "\"aria-arrow\").innerHTML=\"Sorting by \"+headings[b].lastChild.textContent+\" a" +
                            "scending\"}else{ascend=false;document.getElementById(\"aria-arrow\").innerHTML=" +
                            "\"Sorting by \"+headings[b].lastChild.textContent+\" descending\"}}else{span.sty" +
                            "le.visibility=\"hidden\"}b+=1}while(b<len);rowlist=[];rows=tbody.getElementsByTa" +
                            "gName(\"tr\");len=rows.length;b=0;do{rowlist.push(rows[b]);b+=1}while(b<len);row" +
                            "list.sort(rowsort);b=0;do{if(b%2===0){rowlist[b].setAttribute(\"class\",\"even\"" +
                            ")}else{rowlist[b].setAttribute(\"class\",\"odd\")}tbody.removeChild(rowlist[b]);" +
                            "tbody.appendChild(rowlist[b]);b+=1}while(b<len)};do{headings[a].onclick=function" +
                            "(e){sorter(this);e.preventDefault();return false;};a+=1}while(a<hlen);document.g" +
                            "etElementsByTagName(\"thead\")[0].getElementsByTagName(\"th\")[start].getElement" +
                            "sByTagName(\"span\")[0].innerHTML=\"▲\";document.getElementsByTagName(\"thead\")" +
                            "[0].getElementsByTagName(\"th\")[start].getElementsByTagName(\"span\")[0].style." +
                            "visibility=\"visible\";sorter(document.getElementsByTagName(\"thead\")[0].getEle" +
                            "mentsByTagName(\"th\")[start])}());";
                file = file.replace(/\!\!app\u0020name\!\!/g, data.packjson.name);
                if (typeof data.packjson.author === "string") {
                    file = file.replace("</title> <", "</title> <meta content=\"" + data.packjson.author.replace(/\s+/g, " ").replace(/"/g, "") + "\" name=\"author\"/> <");
                }
                filedata
                    .forEach(function biddle_publish_indexfile_filedata(val) {
                        var build    = [],
                            monthval = val
                                .date
                                .slice(4, 6),
                            month    = {
                                "01": "January",
                                "02": "February",
                                "03": "March",
                                "04": "April",
                                "05": "May",
                                "06": "June",
                                "07": "July",
                                "08": "August",
                                "09": "September",
                                "10": "October",
                                "11": "November",
                                "12": "December"
                            },
                            varname  = (val.variant === "")
                                ? "Full Application"
                                : val.variant;
                        build.push("<tr><td>");
                        build.push(val.version);
                        build.push("</td><td data-date=\"");
                        build.push(val.date);
                        build.push("\">");
                        build.push(val.date.slice(6));
                        build.push("\u0020");
                        build.push(month[monthval]);
                        build.push("\u0020");
                        build.push(val.date.slice(0, 4));
                        build.push("</td><td data-size=\"");
                        build.push(val.size);
                        build.push("\">");
                        build.push(apps.commas(Number(val.size)));
                        build.push("</td><td>");
                        build.push(varname);
                        build.push("</td><td><a href=\"");
                        build.push(val.filename);
                        build.push("\">");
                        build.push(val.filename);
                        build.push("</a></td></tr>");
                        rows.push(build.join(""));
                    });
                file = file.replace(/\!\!row\!\!/, rows.join(""));
                apps.writeFile(file, publoc + "index.xhtml",
                function biddle_publish_indexfile_readIndex_index_writeXhtml() {
                    return true;
                });
                apps.writeFile(script, publoc + "biddlesort.js",
                function biddle_publish_indexfile_readIndex_writeScript() {
                    return true;
                });
            },
            zippy     = function biddle_publish_zippy(vardata) {
                apps
                    .zip(function biddle_publish_zippy_zip(zipfilename, writejson) {
                        node
                            .fs
                            .stat(zipfilename, function biddle_publish_zippy_zip_stat(erstat, stats) {
                                var filename = zipfilename
                                        .split(node.path.sep)
                                        .pop(),
                                    variants = filename
                                        .replace(data.packjson.name, "")
                                        .split("_"),
                                    variant  = "",
                                    sdate    = new Date(),
                                    year     = String(sdate.getUTCFullYear()),
                                    month    = String(sdate.getMonth() + 1),
                                    day      = String(sdate.getDate());
                                if (erstat !== null) {
                                    return apps.errout({
                                        error: erstat,
                                        name : "biddle_publish_zippy_zip_stat"
                                    });
                                }
                                if (typeof stats !== "object") {
                                    return apps.errout({
                                        error: "stats is not an object, from node.fs.stat",
                                        name : "biddle_publish_zippy_zip_stat"
                                    });
                                }
                                if (month.length < 2) {
                                    month = "0" + month;
                                }
                                if (day.length < 2) {
                                    day = "0" + day;
                                }
                                if (variants.length > 2) {
                                    variant = variants[1];
                                }
                                filedata.push({
                                    date    : year + month + day,
                                    filename: filename,
                                    size    : stats.size,
                                    variant : variant,
                                    version : data.packjson.version
                                });
                                varcount += 1;
                                if (varcount === varlen) {
                                    node
                                        .fs
                                        .readFile(publoc + "filedata.json",
                                        function biddle_publish_zippy_zip_stat_readfiledata(erd, catalogue) {
                                            var parsed = {};
                                            if (erd !== null && erd !== "") {
                                                if (erd.toString().indexOf("no such file or directory") > 0) {
                                                    apps
                                                        .writeFile(JSON.stringify({
                                                            filedata: filedata
                                                        }), publoc + "filedata.json",
                                                        function biddle_publish_zippy_zip_stat_readfiledata_writeNew() {
                                                            return true;
                                                        });
                                                    return indexfile();
                                                }
                                                return apps.errout({
                                                    error: erd,
                                                    name : "biddle_publish_zippy_zip_stat_readfiledata"
                                                });
                                            }
                                            parsed   = JSON.parse(catalogue);
                                            filedata = filedata.concat(parsed.filedata);
                                            apps.writeFile(JSON.stringify({
                                                filedata: filedata
                                            }), publoc + "filedata.json",
                                            function biddle_publish_zippy_zip_stat_readfiledata_write() {
                                                return true;
                                            });
                                            indexfile();
                                        });
                                }
                            });
                        apps.hash(zipfilename, "hashFile", function biddle_publish_zippy_zip_hash() {
                            apps
                                .writeFile(data.hashFile, zipfilename.replace(".zip", ".hash"), function biddle_publish_zippy_zip_hash_writehash() {
                                    return true;
                                });
                            if (writejson === true && vardata.final === true) {
                                apps
                                    .writeFile(JSON.stringify(data.published), data.abspath + "published.json",
                                    function biddle_publish_zippy_zip_hash_writeJSON() {
                                        apps
                                            .rmrecurse(data.abspath + "temp",
                                            function biddle_publish_zippy_zip_hash_writeJSON_removeTemp() {
                                                return true;
                                            });
                                    });
                            }
                        });
                    }, vardata);
            },
            execution = function biddle_publish_execution() {
                var vflag    = 0,
                    variants = (typeof data.packjson.publication_variants === "object")
                        ? Object.keys(data.packjson.publication_variants)
                        : [];
                variants.push("biddletempprimary");
                varlen = (data.latestVersion === true)
                    ? variants.length * 2
                    : variants.length;
                apps.makedir("temp", function biddle_publish_execution_variantDir() {
                    variants
                        .forEach(function biddle_publish_execution_variantsDir_each(value) {
                            var varobj = (value === "biddletempprimary")
                                ? {}
                                : data.packjson.publication_variants[value];
                            value = apps.sanitizef(value);
                            if (typeof varobj.exclusions !== "object" || typeof varobj.exclusions.join !== "function") {
                                varobj.exclusions = [];
                            }
                            varobj.exclusions = varobj
                                .exclusions
                                .concat(data.ignore);
                            varobj
                                .exclusions
                                .sort();
                            apps.copy(data.input[2], data.abspath + "temp" + node.path.sep + value,
                            varobj.exclusions, function biddle_publish_execution_variantsDir_each_copy() {
                                var complete = function biddle_publish_execution_variantsDir_each_copy_complete() {
                                        var location = data.abspath + "temp" + node.path.sep + value + node.path.sep + data.packjson.name,
                                            valname  = (value === "biddletempprimary")
                                                ? ""
                                                : value,
                                            finalVar = (vflag === variants.length - 1);
                                        vflag += 1;
                                        zippy({
                                            final   : finalVar,
                                            location: location,
                                            name    : valname
                                        });
                                    },
                                    tasks    = function biddle_publish_execution_variantsDir_each_copy_tasks() {
                                        node
                                            .child(varobj.tasks[0], function biddle_publish_execution_variantsDir_each_copy_tasks_child(ert, stdoutt, stdert) {
                                                var len = varobj.tasks.length - 1;
                                                if (ert !== null) {
                                                    console.log(text.bold + text.red + "Error:" + text.none + " with variant " + value + " on publish task");
                                                    console.log(varobj.tasks[0]);
                                                    console.log(ert);
                                                } else if (stdert !== null && stdert !== "") {
                                                    console.log(text.bold + text.red + "Error:" + text.none + " with variant " + value + " on publish task");
                                                    console.log(varobj.tasks[0]);
                                                    console.log(stdert);
                                                } else {
                                                    console.log(text.bold + text.green + "Complete:" + text.none + " with variant " + value + " on publish task");
                                                    console.log(varobj.tasks[0]);
                                                    console.log(stdoutt);
                                                }
                                                varobj
                                                    .tasks
                                                    .splice(0, 1);
                                                if (len > 0) {
                                                    biddle_publish_execution_variantsDir_each_copy_tasks();
                                                } else {
                                                    complete();
                                                }
                                            });
                                    };
                                if (varobj.tasks === "object" && varobj.tasks.length > 0) {
                                    tasks();
                                } else {
                                    complete();
                                }
                            });
                        });
                });
            },
            preexec   = function biddle_publish_preexec() {
                if (data.address.target.indexOf(node.path.sep + "publications") + 1 === data.address.target.length - 13) {
                    data.address.target = data.address.target + apps.sanitizef(data.packjson.name) + node.path.sep;
                }
                apps
                    .makedir(data.address.target, function biddle_publish_preexec_makedir() {
                        if (data.latestVersion === true) {
                            varlen                                    = varlen * 2;
                            data.published[data.packjson.name].latest = data.packjson.version;
                            apps.writeFile(data.packjson.version, data.address.target + "latest.txt",
                            function biddle_zip_makedir_latestTXT() {
                                execution();
                            });
                        } else {
                            execution();
                        }
                    });
            };
        apps.getpjson(function biddle_publish_callback() {
            if (data.published[data.packjson.name] !== undefined && data.published[data.packjson.name].versions.indexOf(data.packjson.version) > -1) {
                return apps.errout({
                    error: "Attempted to publish " + data.packjson.name + " over existing version " + data.packjson.version,
                    name : "biddle_publish_execution"
                });
            }
            if (data.published[data.packjson.name] !== undefined && data.input[3] !== undefined) {
                data.input = data
                    .input
                    .slice(0, 3);
            } else if (data.published[data.packjson.name] === undefined) {
                data.published[data.packjson.name]           = {};
                data.published[data.packjson.name].versions  = [];
                data.published[data.packjson.name].latest    = "";
                data.published[data.packjson.name].directory = data.address.target + apps.sanitizef(data.packjson.name) + node.path.sep;
            }
            data.packjson.name  = apps.sanitizef(data.packjson.name);
            publoc              = data.address.publications + data.packjson.name + node.path.sep;
            data.address.target = data.address.target + data.packjson.name + node.path.sep;
            data
                .published[data.packjson.name]
                .versions
                .push(data.packjson.version);
            data.latestVersion = (function biddle_publish_callback_latestVersion() {
                var ver = "",
                    sem = [],
                    cur = [],
                    len = 0,
                    a   = 0;
                if (ver.indexOf("alpha") > -1 || ver.indexOf("beta") > -1) {
                    return false;
                }
                if (data.published[data.packjson.name].latest === "") {
                    return true;
                }
                ver = data.packjson.version;
                sem = ver.split(".");
                cur = data
                    .published[data.packjson.name]
                    .latest
                    .split(".");
                len = (Math.max(sem, cur));
                do {
                    if (isNaN(sem[a]) === false && isNaN(cur[a]) === false) {
                        if (sem[a] > cur[a]) {
                            return true;
                        }
                        if (cur[a] < sem[a]) {
                            return false;
                        }
                    }
                    if (sem[a] === undefined) {
                        return true;
                    }
                    if (cur[a] === undefined) {
                        return false;
                    }
                    if (isNaN(cur[a]) === true) {
                        return false;
                    }
                    a += 1;
                } while (a < len);
                return true;
            }());
            preexec();
        });
    };
    apps.readBinary  = function biddle_readBinary(filePath, callback) {
        var size        = 0,
            fdescript   = 0,
            writeBinary = function biddle_readBinary_writeBinary() {
                node
                    .fs
                    .open(data.address.downloads + node.path.sep + data.fileName, "w", function biddle_readBinary_writeBinary_writeopen(errx, fd) {
                        var buffer = new Buffer(size);
                        if (errx !== null) {
                            return apps.errout({
                                error: errx,
                                name : "biddle_readBinary_writeBinary_writeopen"
                            });
                        }
                        node
                            .fs
                            .read(fdescript, buffer, 0, size, 0, function biddle_readBinary_writeBinary_writeopen_read(erry, ready, buffy) {
                                if (erry !== null) {
                                    return apps.errout({
                                        error: erry,
                                        name : "biddle_readBinary_writeBinary_writeopen_read"
                                    });
                                }
                                if (ready > 0) {
                                    node
                                        .fs
                                        .write(fd, buffy, 0, size, function biddle_readBinary_writeBinary_writeopen_read_write(errz, written, buffz) {
                                            if (errz !== null) {
                                                return apps.errout({
                                                    error: errz,
                                                    name : "biddle_readBinary_writeBinary_writeopen_read_write"
                                                });
                                            }
                                            if (written < 1) {
                                                return apps.errout({
                                                    error: "Reading binary file " + filePath + " but 0 bytes were read.",
                                                    name : "biddle_readBinary_writeBinary_writeopen_read_write"
                                                });
                                            }
                                            callback(buffz.toString("utf8", 0, written));
                                        });
                                }
                            });
                    });
            };
        node
            .fs
            .stat(filePath, function biddle_readBinary_stat(errs, stats) {
                if (errs !== null) {
                    return apps.errout({
                        error: errs,
                        name : "biddle_readBinary_stat"
                    });
                }
                size = stats.size;
                node
                    .fs
                    .open(filePath, "r", function biddle_readyBinary_stat_open(erro, fd) {
                        var length = (stats.size < 100)
                                ? stats.size
                                : 100,
                            buffer = new Buffer(length);
                        fdescript = fd;
                        if (erro !== null) {
                            return apps.errout({
                                error: erro,
                                name : "biddle_readBinary_stat_open"
                            });
                        }
                        node
                            .fs
                            .read(fd, buffer, 0, length, 1, function biddle_readyBinary_stat_open_read(errr, read, buff) {
                                var bstring = "";
                                if (errr !== null) {
                                    return apps.errout({
                                        error: errr,
                                        name : "biddle_readBinary_stat_open_read"
                                    });
                                }
                                bstring = buff.toString("utf8", 0, buff.length);
                                bstring = bstring.slice(2, bstring.length - 2);
                                if ((/[\u0002-\u0008]|[\u000e-\u001f]/).test(bstring) === true) {
                                    writeBinary();
                                } else {
                                    node
                                        .fs
                                        .readFile(filePath, "utf8", function biddle_readBinary_stat_open_read_readFile(errf, fileData) {
                                            if (errf !== null && errf !== undefined) {
                                                return apps.errout({
                                                    error: errf,
                                                    name : "biddle_readBinary_stat_open_read_readFile"
                                                });
                                            }
                                            if (data.command === "install" && (/(\.hash)$/).test(filePath) === true) {
                                                data.hashFile = fileData;
                                                callback(fileData);
                                            } else if (data.command === "status") {
                                                callback(fileData, filePath);
                                            } else if (data.command === "install" && (/(latest\.txt)$/).test(filePath) === true) {
                                                callback(fileData);
                                            } else {
                                                apps.writeFile(fileData, apps.sanitizef(filePath), callback);
                                            }
                                        });
                                }
                                return read;
                            });
                    });
            });
    };
    apps.readlist    = function biddle_readlist() {
        var datalist = "";
        if (data.command === "publish" || (data.command === "list" && data.input[2] === "published")) {
            datalist = "published";
        } else if (data.command === "installed" || data.command === "status" || (data.command === "list" && data.input[2] === "installed")) {
            datalist = "installed";
        } else {
            return apps.errout({
                error: "Unqualified operation: readlist() but command is not published or installed.",
                name : "biddle_readlist"
            });
        }
        node
            .fs
            .readFile(datalist + ".json",
            "utf8", function biddle_readlist_readFile(err, fileData) {
                var jsondata = JSON.parse(fileData);
                if (err !== null && err !== undefined) {
                    return apps.errout({
                        error: err,
                        name : "biddle_readlist_readFile"
                    });
                }
                data[datalist]        = jsondata[datalist];
                data.status[datalist] = true;
            });
    };
    apps.relToAbs    = function biddle_relToAbs(filepath, reference) {
        var abs     = reference
                .replace(/((\/|\\)+)$/, "")
                .split(node.path.sep),
            rel     = filepath.split(node.path.sep),
            cur     = data
                .cwd
                .split(node.path.sep),
            a       = 0,
            b       = 0,
            reftest = false;
        if (data.platform === "win32") {
            if ((/^(\w:\\)/).test(filepath) === true) {
                return filepath;
            }
            if ((/^(\w:\\)/).test(reference) === true) {
                reftest = true;
            }
        } else {
            if (filepath.charAt(0) === "/") {
                return filepath;
            }
            if (reference.charAt(0) === "/") {
                reftest = true;
            }
        }
        if (data.cwd !== reference && reftest === false) {
            if (abs[0] === "..") {
                do {
                    cur.pop();
                    abs.splice(0, 1);
                } while (cur[0] === "..");
            } else if (cur[0] === ".") {
                cur.splice(0, 1);
            }
            abs = cur.concat(abs);
        }
        if (rel[0] === "..") {
            do {
                abs.pop();
                rel.splice(0, 1);
            } while (rel[0] === "..");
        } else if (rel[0] === ".") {
            rel.splice(0, 1);
        }
        b = rel.length;
        if (b < 0) {
            do {
                rel[a] = apps.sanitizef(rel[a]);
                a      += 1;
            } while (a < b);
        }
        return abs.join(node.path.sep) + node.path.sep + rel.join(node.path.sep);
    };
    apps.rmrecurse   = function biddle_rmrecurse(dirToKill, callback) {
        node
            .child(cmds.remove(dirToKill), function biddle_rmrecurse_child(err, stdout, stderrout) {
                if (err !== null && err.toString().indexOf("No such file or directory") < 0 && err.toString().indexOf(": The directory is not empty.") < 0) {
                    if (err.toString().indexOf("Cannot find path") > 0) {
                        return callback();
                    }
                    return apps.errout({
                        error: err,
                        name : "biddle_rmrecurse_child"
                    });
                }
                if (stderrout !== null && stderrout !== "" && stderrout.indexOf("No such file or directory") < 0 && stderrout.indexOf(": The directory is not empty.") < 0) {
                    return apps.errout({
                        error: stderrout,
                        name : "biddle_rmrecurse_child"
                    });
                }
                callback();
                return stdout;
            });
    };
    apps.sanitizef   = function biddle_sanitizef(filePath) {
        var paths    = filePath.split(node.path.sep),
            fileName = paths.pop();
        paths.push(fileName.replace(/\+|<|>|:|"|\||\?|\*|%|\s/g, ""));
        return paths.join("");
    };
    apps.status      = function biddle_status() {
        var list       = [],
            versions   = {},
            a          = 0,
            b          = 0,
            len        = 0,
            single     = false,
            name       = function biddle_status_name(pub) {
                var dirs = [];
                if ((/^(https?:\/\/)/i).test(pub) === true) {
                    dirs = pub.split("/");
                    dirs.pop();
                    return dirs.pop();
                }
                dirs = pub.split(node.path.sep);
                dirs.pop();
                return dirs.pop();
            },
            compare    = function biddle_status_compare() {
                var keys     = Object.keys(versions),
                    klen     = keys.length,
                    k        = 0,
                    currents = [],
                    outs     = [];
                keys.sort();
                do {
                    if (data.installed[keys[k]].version === versions[keys[k]]) {
                        currents.push("* " + keys[k] + " matches published version " + text.cyan + versions[keys[k]] + text.nocolor);
                    } else {
                        outs.push("* " + keys[k] + " is installed at version " + text.bold + text.red + data.installed[keys[k]].version + text.none + " but published version is " + text.cyan + versions[keys[k]] + text.nocolor);
                    }
                    k += 1;
                } while (k < klen);
                klen = outs.length;
                if (klen > 0) {
                    if (single === false) {
                        console.log("");
                        if (currents.length < 1) {
                            console.log(text.underline + text.red + "All Applications Outdated:" + text.none);
                        } else {
                            console.log(text.underline + "Outdated Applications:" + text.normal);
                        }
                    }
                    console.log("");
                    k = 0;
                    do {
                        console.log(outs[k]);
                        k += 1;
                    } while (k < klen);
                }
                klen = currents.length;
                if (klen > 0) {
                    if (single === false) {
                        console.log("");
                        if (outs.length < 1) {
                            console.log(text.underline + text.green + "All Applications Are Current:" + text.none);
                        } else {
                            console.log(text.underline + "Current Applications:" + text.normal);
                        }
                    }
                    console.log("");
                    k = 0;
                    do {
                        console.log(currents[k]);
                        k += 1;
                    } while (k < klen);
                }
            },
            getversion = function biddle_status_get(filedata, filepath) {
                versions[name(filepath)] = filedata;
                b                        += 1;
                if (b === len) {
                    compare();
                }
            };
        if (data.input[2] !== undefined) {
            if (data.installed[data.input[2]] !== undefined) {
                list   = [data.input[2]];
                single = true;
            } else {
                return apps.errout({
                    error: data.input[2] + " is not a biddle installed application.",
                    name : "biddle_status"
                });
            }
        } else {
            list = Object.keys(data.installed);
            if (list.length < 1) {
                return apps.errout({
                    error: "No applications installed by biddle.",
                    name : "biddle_status"
                });
            }
        }
        len = list.length;
        do {
            apps.get(data.installed[list[a]].published + "latest.txt",
            getversion);
            a += 1;
        } while (a < len);
    };
    apps.test        = function biddle_test() {
        var loc     = "",
            test    = "",
            name    = data.input[2],
            spawn   = function biddle_test_spawn() {
                var spwn = require("child_process").spawn,
                    args = test.split(" "),
                    cmd  = args[0],
                    exec = function biddle_test_spawn_init() {
                        return true;
                    };
                args.splice(0, 1);
                exec = spwn(cmd, args, {
                    cwd  : loc,
                    stdio: "inherit"
                });
                if (exec.stdout !== null) {
                    exec
                        .stdout
                        .on("data", function biddle_test_spawn_data(data) {
                            console.log(data);
                        });
                }
                if (exec.stderr !== null) {
                    exec
                        .stderr
                        .on("data", function biddle_test_spawn_stderr(data) {
                            console.log(data);
                        });
                }
                exec
                    .on("error", function biddle_test_spawn_error(data) {
                        apps.errout({
                            error: data,
                            name : "biddle_test_spawn_error"
                        });
                    });
                exec.on("close", function biddle_test_spawn_close() {
                    console.log("biddle has completed test for " + name + " is complete.");
                });
            },
            foreign = function biddle_test_foreign() {
                loc  = name;
                test = data.packjson.test;
                if (test === undefined) {
                    return apps.errout({
                        error: name + " does not have a test property in its package.json",
                        name : "biddle_test_foreign"
                    });
                }
                spawn();
            };
        if (name === undefined || name === "" || name === "biddle") {
            data.input[2] = "biddle";
            return apps.testBiddle();
        }
        if (name.indexOf(node.path.sep) < 0) {
            if (data.installed[name] === undefined) {
                return apps.errout({
                    error: name + " is not a biddle installed appliation. For local directories try ." + node.path.sep + name,
                    name : "biddle_test"
                });
            }
            loc  = data.installed[name].location;
            test = data.installed[name].test;
            spawn();
        } else {
            apps.getpjson(foreign);
        }
    };
    apps.testBiddle  = function biddle_testBiddle() {
        var startTime = Date.now(),
            order     = [
                "moduleInstall",
                "lint",
                "hash",
                "copy",
                "remove",
                "markdown",
                "get",
                "zip",
                "unzip",
                "publish",
                "install",
                "listStatus",
                "uninstall",
                "unpublish"
            ],
            options   = {
                correct     : false,
                crlf        : false,
                html        : true,
                inchar      : " ",
                insize      : 4,
                lang        : "javascript",
                methodchain : false,
                mode        : "beautify",
                nocaseindent: false,
                objsort     : "all",
                preserve    : true,
                styleguide  : "jslint",
                wrap        : 80
            },
            longname  = 0,
            namepad   = function biddle_test_namepad(name) {
                var a = name.length;
                if (name.length === longname) {
                    return name;
                }
                do {
                    a    += 1;
                    name = name + " ";
                } while (a < longname);
                return name;
            },
            modules   = {
                jslint    : {
                    dir    : data.abspath + "JSLint",
                    edition: function biddle_test_lint_modules_jslint(obj) {
                        console.log("* " + namepad(obj.name) + " - " + obj.app().edition);
                    },
                    file   : "jslint.js",
                    name   : "JSLint",
                    repo   : "https://github.com/douglascrockford/JSLint.git"
                },
                prettydiff: {
                    dir    : data.abspath + "prettydiff",
                    edition: function biddle_test_lint_modules_prettydiff(obj) {
                        var str = String(global.prettydiff.edition.latest);
                        console.log("* " + namepad(obj.name) + " - 20" + str.slice(0, 2) + "-" + str.slice(2, 4) + "-" + str.slice(4) + ", version " + global.prettydiff.edition.version);
                    },
                    file   : "prettydiff.js",
                    name   : "Pretty Diff",
                    repo   : "https://github.com/prettydiff/prettydiff.git"
                }
            },
            keys      = Object.keys(modules),
            childcmd  = (data.platform === "win32")
                ? (data.abspath === process.cwd().toLowerCase() + node.path.sep)
                    ? "node " + data.abspath + "biddle "
                    : "biddle "
                : (data.abspath === process.cwd() + node.path.sep)
                    ? "node " + data.abspath + "biddle "
                    : "biddle ",
            testpath  = data.abspath + "unittest",
            humantime = function biddle_test_humantime(finished) {
                var minuteString = "",
                    hourString   = "",
                    secondString = "",
                    finalMem     = "",
                    minutes      = 0,
                    hours        = 0,
                    elapsed      = 0,
                    memory       = {},
                    prettybytes  = function biddle_test_humantime_prettybytes(an_integer) {
                        //find the string length of input and divide into triplets
                        var length  = an_integer
                                .toString()
                                .length,
                            triples = (function biddle_test_humantime_prettybytes_triples() {
                                if (length < 22) {
                                    return Math.floor((length - 1) / 3);
                                }
                                //it seems the maximum supported length of integer is 22
                                return 8;
                            }()),
                            //each triplet is worth an exponent of 1024 (2 ^ 10)
                            power   = (function biddle_test_humantime_prettybytes_power() {
                                var a = triples - 1,
                                    b = 1024;
                                if (triples === 0) {
                                    return 0;
                                }
                                if (triples === 1) {
                                    return 1024;
                                }
                                do {
                                    b = b * 1024;
                                    a -= 1;
                                } while (a > 0);
                                return b;
                            }()),
                            //kilobytes, megabytes, and so forth...
                            unit    = [
                                "",
                                "KB",
                                "MB",
                                "GB",
                                "TB",
                                "PB",
                                "EB",
                                "ZB",
                                "YB"
                            ],
                            output  = "";

                        if (typeof an_integer !== "number" || isNaN(an_integer) === true || an_integer < 0 || an_integer % 1 > 0) {
                            //input not a positive integer
                            output = "0.00B";
                        } else if (triples === 0) {
                            //input less than 1000
                            output = an_integer + "B";
                        } else {
                            //for input greater than 999
                            length = Math.floor((an_integer / power) * 100) / 100;
                            output = length.toFixed(2) + unit[triples];
                        }
                        return output;
                    },
                    plural       = function biddle_test_humantime_plural(x, y) {
                        var a = "";
                        if (x !== 1) {
                            a = x + y + "s ";
                        } else {
                            a = x + y + " ";
                        }
                        return a;
                    },
                    minute       = function biddle_test_humantime_minute() {
                        minutes      = parseInt((elapsed / 60), 10);
                        minuteString = (finished === true)
                            ? plural(minutes, " minute")
                            : (minutes < 10)
                                ? "0" + minutes
                                : "" + minutes;
                        minutes      = elapsed - (minutes * 60);
                        secondString = (finished === true)
                            ? (minutes === 1)
                                ? " 1 second "
                                : minutes.toFixed(3) + " seconds "
                            : minutes.toFixed(3);
                    };
                memory       = process.memoryUsage();
                finalMem     = prettybytes(memory.rss);

                //last line for additional instructions without bias to the timer
                elapsed      = (Date.now() - startTime) / 1000;
                secondString = elapsed.toFixed(3);
                if (elapsed >= 60 && elapsed < 3600) {
                    minute();
                } else if (elapsed >= 3600) {
                    hours      = parseInt((elapsed / 3600), 10);
                    elapsed    = elapsed - (hours * 3600);
                    hourString = (finished === true)
                        ? plural(hours, " hour")
                        : (hours < 10)
                            ? "0" + hours
                            : "" + hours;
                    minute();
                } else {
                    secondString = (finished === true)
                        ? plural(secondString, " second")
                        : secondString;
                }
                if (finished === true) {
                    if (data.platform === "win32") {
                        hourString = "\n" + hourString;
                    } else {
                        hourString = "\r\n" + hourString;
                    }
                    return finalMem + " of memory consumed" + hourString + minuteString + secondString + "total time";
                }
                if (hourString === "") {
                    hourString = "00";
                }
                if (minuteString === "") {
                    minuteString = "00";
                }
                if ((/^([0-9]\.)/).test(secondString) === true) {
                    secondString = "0" + secondString;
                }
                return text.cyan + "[" + hourString + ":" + minuteString + ":" + secondString + "]" + text.nocolor + " ";
            },
            diffFiles = function biddle_test_diffFiles(sampleName, sampleSource, sampleDiff) {
                var aa     = 0,
                    line   = 0,
                    pdlen  = 0,
                    count  = 0,
                    diffs  = 0,
                    lcount = 0,
                    report = [];
                options.mode    = "diff";
                options.source  = sampleSource.replace(/\u001b/g, "\\u001b");
                options.diff    = sampleDiff.replace(/\u001b/g, "\\u001b");
                options.diffcli = true;
                options.context = 2;
                options.lang    = "text";
                report          = modules
                    .prettydiff
                    .app(options)[0];
                pdlen           = report[0].length;
                if (report.length < 3) {
                    console.log("");
                    console.log(text.red + "Test diff operation provided a bad code sample:" + text.nocolor);
                    console.log(report[0]);
                    return apps.errout({
                        error: text.red + "bad test" + text.nocolor,
                        name : sampleName,
                        time : humantime(true)
                    });
                }
                console.log(text.red + "Test Failure with Comparison" + text.nocolor);
                console.log(text.underline + "First Sample" + text.normal);
                console.log(sampleSource);
                console.log("");
                console.log(text.underline + "Second Sample" + text.normal);
                console.log(sampleDiff);
                console.log("");
                console.log(text.underline + "Comparison" + text.normal);
                // report indexes from diffcli feature of diffview.js
                // 0. source line number
                // 1. source code line
                // 2. diff line number
                // 3. diff code line
                // 4. change
                // 5. index of options.context (not parallel) 6 - total count of differences
                if (sampleName !== "phases.simulations" && report[0][0] < 2) {
                    diffs += 1;
                    console.log("");
                    console.log(text.cyan + sampleName + text.nocolor);
                    console.log(text.cyan + "Line: 1" + text.nocolor);
                }
                for (aa = 0; aa < pdlen; aa += 1) {
                    if (report[4][aa] === "equal" && report[4][aa + 1] === "equal" && report[4][aa + 2] !== undefined && report[4][aa + 2] !== "equal") {
                        count += 1;
                        if (count === 51) {
                            break;
                        }
                        line   = report[0][aa] + 2;
                        lcount = 0;
                        diffs  += 1;
                        console.log("");
                        console.log(text.cyan + sampleName + text.nocolor);
                        console.log(text.cyan + "Line: " + line + text.nocolor);
                        if (aa === 0) {
                            console.log(report[3][aa]);
                            console.log(report[3][aa + 1]);
                        }
                    }
                    if (lcount < 7) {
                        lcount += 1;
                        if (report[4][aa] === "delete" && report[0][aa] !== report[0][aa + 1]) {
                            if (report[1][aa] === "") {
                                report[1][aa] = "(empty line)";
                            } else if (report[1][aa].replace(/\u0020+/g, "") === "") {
                                report[1][aa] = "(indentation)";
                            }
                            console.log(text.red + report[1][aa].replace(/<p(d)>/g, text.bold).replace(/<\/pd>/g, text.normal) + text.nocolor);
                        } else if (report[4][aa] === "insert" && report[2][aa] !== report[2][aa + 1]) {
                            if (report[3][aa] === "") {
                                report[3][aa] = "(empty line)";
                            } else if (report[3][aa].replace(/\u0020+/g, "") === "") {
                                report[3][aa] = "(indentation)";
                            }
                            console.log(text.green + report[3][aa].replace(/<p(d)>/g, text.bold).replace(/<\/pd>/g, text.normal) + text.nocolor);
                        } else if (report[4][aa] === "equal" && aa > 1) {
                            console.log(report[3][aa]);
                        } else if (report[4][aa] === "replace") {
                            console.log(text.red + report[1][aa].replace(/<p(d)>/g, text.bold).replace(/<\/pd>/g, text.normal) + text.nocolor);
                            console.log(text.green + report[3][aa].replace(/<p(d)>/g, text.bold).replace(/<\/pd>/g, text.normal) + text.nocolor);
                        }
                    }
                }
                console.log("");
                console.log(diffs + text.cyan + " differences counted." + text.nocolor);
                apps.errout({
                    error: "Pretty Diff " + text.red + "failed" + text.nocolor + " in function: " + text.cyan + sampleName + text.nocolor,
                    name : sampleName,
                    time : humantime(true)
                });
            },
            phases    = {},
            next      = function biddle_test_next() {
                console.log("");
                if (order.length < 1) {
                    return apps.rmrecurse(testpath, function biddle_test_next_rmdir() {
                        console.log("All tasks complete... Exiting clean!");
                        console.log(humantime(true));
                        process.exit(0);
                    });
                }
                phases[order[0]]();
                order.splice(0, 1);
            };
        phases.copy          = function biddle_test_copy() {
            node
                .child(childcmd + "copy " + data.abspath + "test" + node.path.sep + "biddletesta" + node.path.sep + "biddletesta.js " + testpath + " childtest", {
                    cwd: data.abspath
                }, function biddle_test_copy_child(er, stdout, stder) {
                    var copytest = "Copied " + data.abspath + "test" + node.path.sep + "biddletesta" + node.path.sep + "biddletesta.js to " + data.abspath + "unittest\nFiles: 1, Directories: 0, Symlinks: 0",
                        copyfile = data.abspath + "unittest" + node.path.sep + "biddletesta.js";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_copy_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_copy_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    stdout = stdout
                        .replace(/(\s+)$/, "")
                        .replace(/\r\n/g, "\n");
                    if (stdout !== copytest) {
                        return diffFiles("biddle_test_copy_child", stdout, copytest);
                    }
                    node
                        .fs
                        .stat(copyfile, function biddle_test_copy_child_stat(ers, stats) {
                            if (ers !== null) {
                                return apps.errout({
                                    error : ers,
                                    name  : "biddle_test_copy_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (stats === undefined || stats.isFile() === false) {
                                return apps.errout({
                                    error : "copy failed as " + copyfile + " is not present",
                                    name  : "biddle_test_copy_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            console.log(humantime(false) + " " + text.green + "copy test passed." + text.nocolor);
                            next();
                        });
                });
        };
        phases.get           = function biddle_test_get() {
            node
                .child(childcmd + "get http://www.google.com " + data.abspath + "unittest childtest", {
                    cwd: data.abspath
                }, function biddle_test_get_child(er, stdout, stder) {
                    var size = "";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_get_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_get_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    size = stdout.slice(stdout.indexOf("written at") + 10).replace(/(\s+)$/, "");
                    if ((/^(((File)|(\d{3}))\u0020)/).test(stdout) === false || stdout.indexOf("File\u0020") < 0 || stdout.indexOf(" 0 bytes") > 0 || size.replace(" bytes.", "").length < 4) {
                        return apps.errout({
                            error: "Unexpected output for test 'get':\r\n" + text.red + stdout + text.nocolor,
                            name : "biddle_test_get_child",
                            time : humantime(true)
                        });
                    }
                    console.log(humantime(false) + " " + text.green + "get test passed." + text.nocolor + " File written at" + size);
                    next();
                });
        };
        phases.hash          = function biddle_test_hash() {
            node
                .child(childcmd + "hash " + data.abspath + "LICENSE childtest", {
                    cwd: data.abspath
                }, function biddle_test_hash_child(er, stdout, stder) {
                    var hashtest = "be09a71a2cda28b74e9dd206f46c1621aebe29182723f191d8109db4705ced014de469043c397fee" +
                            "4d8f3483e396007ca739717af4bf43fed4c2e3dd14f3dc0c";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_hash_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_hash_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    stdout = stdout.replace(/((\r?\n)+)$/, "");
                    if (stdout !== hashtest) {
                        return diffFiles("biddle_test_hash_child", stdout, hashtest);
                    }
                    console.log(humantime(false) + " " + text.green + "hash test passed." + text.nocolor);
                    next();
                });
        };
        phases.install       = function biddle_test_install() {
            node
                .child(childcmd + "install " + data.abspath + "publications" + node.path.sep + "biddletesta" + node.path.sep + "biddletesta_latest.zip childtest", {
                    cwd: data.abspath
                }, function biddle_test_install_child(er, stdout, stder) {
                    var instfile = data.abspath + "applications" + node.path.sep + "biddletesta" + node.path.sep + "liba" + node.path.sep + "libab.txt";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_hash_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_hash_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stdout.indexOf("is missing the " + text.cyan + "http(s)" + text.nocolor + " scheme, treating as a local path...") < 7) {
                        return apps.errout({
                            error : "Expected output to contain: is missing the " + text.cyan + "http(s)" + text.nocolor + " scheme, t" +
                                       "reating as a local path...",
                            name  : "biddle_test_install_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    node
                        .fs
                        .stat(instfile, function biddle_test_install_child_stat(err, stats) {
                            if (err !== null) {
                                return apps.errout({
                                    error : err,
                                    name  : "biddle_test_hash_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (typeof stats !== "object" || stats.isFile() === false) {
                                return apps.errout({
                                    error : instfile + " does not exist.",
                                    name  : "biddle_test_hash_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            console.log(humantime(false) + " " + text.green + "File from install is present:" + text.nocolor + " " + instfile);
                            node
                                .fs
                                .readFile(data.abspath + "installed.json",
                                function biddle_test_install_child_stat_readJSON(era, filedata) {
                                    var inst = {};
                                    if (era !== null && era !== undefined) {
                                        return apps.errout({
                                            error : instfile + " does not exist.",
                                            name  : "biddle_test_hash_child_stat_readJSON",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    inst = JSON.parse(filedata);
                                    if (inst.biddletesta === undefined) {
                                        return apps.errout({
                                            error : "biddletesta is absent from installed.json",
                                            name  : "biddle_test_hash_child_stat_readJSON",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    if (inst.biddletesta.version !== "99.99.1234") {
                                        return apps.errout({
                                            error : "Expected biddletesta.version of installed.json to be '99.99.1234'.",
                                            name  : "biddle_test_hash_child_stat_readJSON",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    console.log(humantime(false) + " " + text.green + "installed.json contains biddletesta." + text.nocolor);
                                    console.log(humantime(false) + " " + text.green + "install test passed." + text.nocolor);
                                    next();
                                });
                        });
                });
        };
        phases.lint          = function biddle_test_lint() {
            var ignoreDirectory = [
                    ".git",
                    "applications",
                    "bin",
                    "downloads",
                    "publications",
                    "unittest"
                ],
                files           = [],
                lintrun         = function biddle_test_lint_lintrun() {
                    var lintit = function biddle_test_lint_lintrun_lintit(val, ind, arr) {
                        var result = {},
                            failed = false,
                            ecount = 0,
                            report = function biddle_test_lint_lintrun_lintit_lintOn_report(warning) {
                                //start with an exclusion list.  There are some warnings that I don't care about
                                if (warning === null) {
                                    return;
                                }
                                if (warning.message.indexOf("Unexpected dangling '_'") === 0) {
                                    return;
                                }
                                if ((/Bad\u0020property\u0020name\u0020'\w+_'\./).test(warning.message) === true) {
                                    return;
                                }
                                if (warning.message.indexOf("/*global*/ requires") === 0) {
                                    return;
                                }
                                failed = true;
                                if (ecount === 0) {
                                    console.log(text.red + "JSLint errors on" + text.nocolor + " " + val[0]);
                                    console.log("");
                                }
                                ecount += 1;
                                console.log("On line " + warning.line + " at column: " + warning.column);
                                console.log(warning.message);
                                console.log("");
                            };
                        options.source = val[1];
                        result         = modules
                            .jslint
                            .app(modules.prettydiff.app(options), {
                                "for": true
                            });
                        if (result.ok === true) {
                            console.log(humantime(false) + text.green + "Lint is good for file " + (ind + 1) + ":" + text.nocolor + " " + val[0]);
                            if (ind === arr.length - 1) {
                                console.log(text.green + "Lint operation complete!" + text.nocolor);
                                return next();
                            }
                        } else {
                            result
                                .warnings
                                .forEach(report);
                            if (failed === true) {
                                return apps.errout({
                                    error: text.red + "Lint fail" + text.nocolor + " :(",
                                    name : "biddle_test_lint_lintrun_lintit",
                                    time : humantime(true)
                                });
                            }
                            console.log(humantime(false) + text.green + "Lint is good for file " + (ind + 1) + ":" + text.nocolor + " " + val[0]);
                            if (ind === arr.length - 1) {
                                console.log(text.green + "Lint operation complete!" + text.nocolor);
                                next();
                            }
                        }
                    };
                    options = {
                        correct     : false,
                        crlf        : false,
                        html        : true,
                        inchar      : " ",
                        insize      : 4,
                        lang        : "javascript",
                        methodchain : false,
                        mode        : "beautify",
                        nocaseindent: false,
                        objsort     : "all",
                        preserve    : true,
                        styleguide  : "jslint",
                        wrap        : 80
                    };
                    files.forEach(lintit);
                };
            console.log(text.cyan + "Beautifying and Linting" + text.nocolor);
            console.log("** Note that line numbers of error messaging reflects beautified code line.");
            ignoreDirectory.forEach(function biddle_test_lint_absignore(value, index, array) {
                array[index] = data.abspath + value;
            });
            keys.forEach(function biddle_test_lint_updateIgnores(mod) {
                ignoreDirectory.push(modules[mod].dir);
            });
            (function biddle_test_lint_getFiles() {
                var enddirs    = 0,
                    endfiles   = 0,
                    endread    = 0,
                    startdirs  = 1,
                    startfiles = 0,
                    startread  = 0,
                    idLen      = ignoreDirectory.length,
                    readFile   = function biddle_test_lint_getFiles_readFile(filePath) {
                        node
                            .fs
                            .readFile(filePath, "utf8", function biddle_test_lint_getFiles_readFile_callback(err, data) {
                                if (err !== null && err !== undefined) {
                                    return apps.errout({
                                        error: err,
                                        name : "biddle_test_lint_getFiles_readFile_callback",
                                        time : humantime(false)
                                    });
                                }
                                files.push([
                                    filePath,
                                    data
                                ]);
                                endread += 1;
                                if (endread === startread && endfiles === startfiles && enddirs === startdirs) {
                                    lintrun();
                                }
                            });
                    },
                    readDir    = function biddle_test_lint_getFiles_readDir(filepath) {
                        node
                            .fs
                            .readdir(filepath, function biddle_test_lint_getFiles_readDir_callback(erra, list) {
                                var fileEval = function biddle_test_lint_getFiles_readDir_callback_fileEval(val) {
                                    var filename = (filepath.charAt(filepath.length - 1) === node.path.sep)
                                        ? filepath + val
                                        : filepath + node.path.sep + val;
                                    node
                                        .fs
                                        .stat(filename, function biddle_test_lint_getFiles_readDir_callback_fileEval_stat(errb, stat) {
                                            var a = 0;
                                            endfiles += 1;
                                            if (errb !== null) {
                                                return apps.errout({
                                                    error: errb,
                                                    name : "biddle_test_lint_getFiles_readDir_callback_fileEval_stat",
                                                    time : humantime(false)
                                                });
                                            }
                                            if (stat.isFile() === true && (/(\.js)$/).test(filename) === true) {
                                                startread += 1;
                                                readFile(filename);
                                            }
                                            if (stat.isDirectory() === true) {
                                                startdirs += 1;
                                                do {
                                                    if (filename === ignoreDirectory[a]) {
                                                        enddirs += 1;
                                                        if (endread === startread && endfiles === startfiles && enddirs === startdirs) {
                                                            lintrun();
                                                        }
                                                        return;
                                                    }
                                                    a += 1;
                                                } while (a < idLen);
                                                biddle_test_lint_getFiles_readDir(filename);
                                            }
                                        });
                                };
                                if (erra !== null) {
                                    return apps.errout({
                                        error: "Error reading path: " + filepath + "\n" + erra,
                                        name : "biddle_test_lint_getFiles_readDir_callback",
                                        time : humantime(false)
                                    });
                                }
                                enddirs    += 1;
                                startfiles += list.length;
                                list.forEach(fileEval);
                            });
                    };
                readDir(data.abspath);
            }());
        };
        phases.listStatus    = function biddle_test_listStatus() {
            var listcmds  = [
                    "publish " + data.abspath + "test" + node.path.sep + "biddletestb",
                    "install " + data.abspath + "publications" + node.path.sep + "biddletestb" + node.path.sep + "biddletestb_latest.zip",
                    "list",
                    "list published",
                    "list installed",
                    "status",
                    "status biddletesta",
                    "status biddletesta",
                    "status",
                    "uninstall biddletestb",
                    "unpublish biddletestb"
                ],
                changed   = false,
                listChild = function biddle_test_listStatus_childWrapper() {
                    node
                        .child(childcmd + listcmds[0] + " childtest", {
                            cwd: data.abspath
                        }, function biddle_test_listStatus_childWrapper_child(er, stdout, stder) {
                            var listout = text.underline + "installed applications:" + text.normal + "\n\n* " + text.cyan + "biddletesta" + text.nocolor + " -" +
                                        " 99.99.1234 - " + data.abspath + "applications" + node.path.sep + "biddletesta" + node.path.sep + "\n* " + text.cyan + "biddletestb" + text.nocolor + " - 98.98.1234 - " + data.abspath + "applications" + node.path.sep + "biddletestb" + node.path.sep + "\n\n" + text.underline + "published applications:" + text.normal + "\n\n* " + text.cyan + "biddletesta" + text.nocolor +
                                        " - 99.99.1234 - " + data.abspath + "publications" + node.path.sep + "biddletesta" + node.path.sep + "\n* " + text.cyan + "biddletestb" + text.nocolor + " - 98.98.1234 - " + data.abspath + "publications" + node.path.sep + "biddletestb" + node.path.sep,
                                listpub = text.underline + "published applications:" + text.normal + "\n\n* " + text.cyan + "biddletesta" + text.nocolor + " -" +
                                        " 99.99.1234 - " + data.abspath + "publications" + node.path.sep + "biddletesta" + node.path.sep + "\n* " + text.cyan + "biddletestb" + text.nocolor + " - 98.98.1234 - " + data.abspath + "publications" + node.path.sep + "biddletestb" + node.path.sep,
                                listist = text.underline + "installed applications:" + text.normal + "\n\n* " + text.cyan + "biddletesta" + text.nocolor + " -" +
                                        " 99.99.1234 - " + data.abspath + "applications" + node.path.sep + "biddletesta" + node.path.sep + "\n* " + text.cyan + "biddletestb" + text.nocolor + " - 98.98.1234 - " + data.abspath + "applications" + node.path.sep + "biddletestb" + node.path.sep,
                                statout = "\n" + text.underline + text.green + "all applications are current:" + text.none + "\n\n* biddl" +
                                        "etesta matches published version " + text.cyan + "99.99.1234" + text.nocolor + "\n* biddletestb m" +
                                        "atches published version " + text.cyan + "98.98.1234" + text.nocolor,
                                statpba = "\n* biddletesta matches published version " + text.cyan + "99.99.1234" + text.nocolor,
                                statpbb = "\n" + text.underline + "outdated applications:" + text.normal + "\n\n* biddletesta is installed at vers" +
                                        "ion " + text.bold + text.red + "99.99.1234" + text.none + " but published version is " +
                                        text.cyan + "11.22.6789" + text.nocolor + "\n\n" + text.underline + "current applications:" + text.normal + "\n\n* b" +
                                        "iddletestb matches published version " + text.cyan + "98.98.1234" + text.nocolor,
                                statpbc = "\n* biddletesta is installed at version " + text.bold + text.red + "99.99.1234" + text.none +
                                        " but published version is " + text.cyan + "11.22.6789" + text.nocolor;
                            if (er !== null) {
                                return apps.errout({
                                    error : er,
                                    name  : "biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (stder !== null && stder !== "") {
                                return apps.errout({
                                    error : stder,
                                    name  : "biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            stdout = stdout
                                .toLowerCase()
                                .replace(/(\s+)$/, "")
                                .replace(/\r\n/g, "\n");
                            if (changed === false && listcmds[0] === "list") {
                                if (stdout !== listout) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, listout);
                                }
                                console.log(humantime(false) + " " + text.green + "mlist output passed." + text.nocolor);
                            }
                            if (changed === false && listcmds[0] === "list published") {
                                if (stdout !== listpub) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, listpub);
                                }
                                console.log(humantime(false) + " " + text.green + "list published output passed." + text.nocolor);
                            }
                            if (changed === false && listcmds[0] === "list installed") {
                                if (stdout !== listist) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, listist);
                                }
                                console.log(humantime(false) + " " + text.green + "list installed output passed." + text.nocolor);
                            }
                            if (changed === false && listcmds[0] === "status") {
                                if (stdout !== statout) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, statout);
                                }
                                console.log(humantime(false) + " " + text.green + "status output passed." + text.nocolor);
                            }
                            if (changed === true && listcmds[0] === "status") {
                                if (stdout !== statpbb) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, statpbb);
                                }
                                console.log(humantime(false) + " " + text.green + "status outdated output passed." + text.nocolor);
                            }
                            if (changed === true && listcmds[0] === "status biddletesta") {
                                if (stdout !== statpbc) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, statpbc);
                                }
                                console.log(humantime(false) + " " + text.green + "status outdated biddletesta output passed." + text.nocolor);
                            }
                            if (changed === false && listcmds[0] === "status biddletesta") {
                                if (stdout !== statpba) {
                                    return diffFiles("biddle_test_listStatus_childWrapper_child(changed: " + changed + ", " + listcmds[0] + ")",
                                    stdout, statpba);
                                }
                                console.log(humantime(false) + " " + text.green + "status biddletesta output passed." + text.nocolor);
                                apps.writeFile("11.22.6789", data.abspath + "publications" + node.path.sep + "biddletesta" + node.path.sep + "latest.txt",
                                function biddle_test_listStatus_childWrapper_child_changeVersion() {
                                    changed = true;
                                    listcmds.splice(0, 1);
                                });
                            } else {
                                listcmds.splice(0, 1);
                            }
                            if (listcmds.length > 0) {
                                biddle_test_listStatus_childWrapper();
                            } else {
                                console.log(humantime(false) + " " + text.green + "list and status tests passed." + text.nocolor);
                                next();
                            }
                        });
                };
            listChild();
        };
        phases.markdown      = function biddle_test_markdown() {
            var flag = {
                "120": false,
                "60" : false,
                "80" : false
            };
            node.child(childcmd + "markdown " + data.abspath + "test" + node.path.sep + "biddletesta" + node.path.sep + "READMEa.md 60 childtest", {
                cwd: data.abspath
            }, function biddle_test_markdown_60(er, stdout, stder) {
                var markdowntest = "\n" + text.underline + text.bold + text.red + "test README" + text.none + "\nsome dummy subtext\n\n" + text.underline + text.bold + text.cyan + "First Secondary Heading" + text.none + "\n    | a big block quote lives here. This is where I\n    | am going to experience with wrapping a block quote a bit\n    | differently from other content.  I need enough text in\n    | this quote to wrap a couple of times, so I will continue\n    | adding some nonsense and as long as it takes to ensure I\n    | have a fully qualified test.\n    | New line in a block quote\n    | More block\n\n  This is a regular paragraph that needs to be long\n  enough to wrap a couple times.  This text will be unique\n  from the text in the block quote because uniqueness saves\n  time when debugging test failures.  I am now writing a\n  bunch of wrapping paragraph gibberish, such as\n  f324fasdaowkefsdva.  That one isn't even a word.  It isn't\n  cool if it doesn't contain a hyperlink,\n  (" + text.cyan + "http://tonowhwere.nothing" + text.nocolor + "), in some text.\n\n  " + text.bold + text.red + "*" + text.none + " list item 1 these also need to wrap like a\n    paragraph. So blah blah wrapping some madness into a\n    list item right gosh darn here and let's see what shakes\n    out of the coolness.\n  " + text.bold + text.red + "*" + text.none + " list item 2 these also need to wrap like a\n    paragraph. So blah blah wrapping some madness into a\n    list item right gosh darn here and let's see what shakes\n    out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " sublist item 1 these also need to wrap like a\n      paragraph. So blah blah wrapping some madness into a\n      list item right gosh darn here and let's see what\n      shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " sublist item 2 these also need to wrap like a\n      paragraph. So blah blah wrapping some madness into a\n      list item right gosh darn here and let's see what\n      shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " subsublist item 1 these also need to wrap\n        like a paragraph. So blah blah wrapping some madness\n        into a list item right gosh darn here and let's see\n        what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " subsublist item 2 these also need to wrap\n        like a paragraph. So blah blah wrapping some madness\n        into a list item right gosh darn here and let's see\n        what shakes out of the coolness.\n  " + text.bold + text.red + "*" + text.none + " list item 3 these also need to wrap like a\n    paragraph. So blah blah wrapping some madness into a\n    list item right gosh darn here and let's see what shakes\n    out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " boo these also need to wrap like a paragraph.\n      So blah blah wrapping some madness into a list item\n      right gosh darn here and let's see what shakes out of\n      the coolness.\n\n  " + text.underline + text.bold + text.green + "First Tertiary Heading" + text.none + "\n    This text should be extra indented.\n\n    " + text.bold + text.red + "*" + text.none + " list item 1\n    " + text.bold + text.red + "*" + text.none + " list item 2\n      " + text.bold + text.red + "-" + text.none + " sublist item 1\n      " + text.bold + text.red + "-" + text.none + " sublist item 2\n        " + text.bold + text.red + "*" + text.none + " subsublist item 1\n        " + text.bold + text.red + "*" + text.none + " subsublist item 2\n    " + text.bold + text.red + "*" + text.none + " list item 3\n      " + text.bold + text.red + "-" + text.none + " boo\n\n    " + text.underline + text.bold + text.yellow + "Gettin Deep with the Headings" + text.none + "\n\n        | a big block quote lives here. This\n        | is where I am going to experience with wrapping a\n        | block quote a bit differently from other content.  I\n        | need enough text in this quote to wrap a couple of\n        | times, so I will continue adding some nonsense and\n        | as long as it takes to ensure I have a fully\n        | qualified test.\n        | New line in a block quote\n        | More block\n\n      Images get converted to their alt text\n      description.\n\n      This is a regular paragraph that needs to be\n      long enough to wrap a couple times.  This text will be\n      unique from the text in the block quote because\n      uniqueness saves time when debugging test failures.  I\n      am now writing a bunch of wrapping paragraph\n      gibberish, such as f324fasdaowkefsdva.  That one isn't\n      even a word.\n\n      " + text.bold + text.red + "*" + text.none + " list item 1 these also need to wrap like\n        a paragraph. So blah blah wrapping some madness into\n        a list item right gosh darn here and let's see what\n        shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " list item 2 these also need to wrap like\n        a paragraph. So blah blah wrapping some madness into\n        a list item right gosh darn here and let's see what\n        shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " sublist item 1 these also need to\n          wrap like a paragraph. So blah blah wrapping some\n          madness into a list item right gosh darn here and\n          let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " sublist item 2 these also need to\n          wrap like a paragraph. So blah blah wrapping some\n          madness into a list item right gosh darn here and\n          let's see what shakes out of the coolness.\n          " + text.bold + text.red + "*" + text.none + " subsublist item 1 these also need\n            to wrap like a paragraph. So blah blah wrapping\n            some madness into a list item right gosh darn\n            here and let's see what shakes out of the\n            coolness.\n          " + text.bold + text.red + "*" + text.none + " subsublist item 2 these also need\n            to wrap like a paragraph. So blah blah wrapping\n            some madness into a list item right gosh darn\n            here and let's see what shakes out of the\n            coolness.\n      " + text.bold + text.red + "*" + text.none + " list item 3 these also need to wrap like\n        a paragraph. So blah blah wrapping some madness into\n        a list item right gosh darn here and let's see what\n        shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " boo these also need to wrap like a\n          paragraph. So blah blah wrapping some madness into\n          a list item right gosh darn here and let's see\n          what shakes out of the coolness.\n\n      " + text.underline + "Command   " + text.normal + text.underline + " Local " + text.normal + text.underline + " Argument Type               " + text.normal + text.underline + " Second Argument " + text.normal + "\n      copy       " + text.bold + text.green + "✓" + text.none + "      file path or directory path  directory path \n      get        " + text.bold + text.yellow + "?" + text.none + "      file path                    none           \n      global     " + text.bold + text.green + "✓" + text.none + "      none                         none           \n      hash       " + text.bold + text.green + "✓" + text.none + "      file path                    none           \n      help       " + text.bold + text.green + "✓" + text.none + "      number                       none           \n      install    " + text.bold + text.yellow + "?" + text.none + "      zip file                     directory path \n      list       " + text.bold + text.green + "✓" + text.none + "      \"" + text.yellow + "installed" + text.nocolor + "\" or \"" + text.yellow + "published" + text.nocolor + "\"   none           \n      markdown   " + text.bold + text.green + "✓" + text.none + "      path to markdown file        number         \n      publish    " + text.bold + text.green + "✓" + text.none + "      directory path               directory path \n      remove     " + text.bold + text.green + "✓" + text.none + "      file path or directory path  none           \n      status     " + text.bold + text.yellow + "?" + text.none + "      none or application name     none           \n      test       " + text.bold + text.red + "X" + text.none + "      none                         none           \n      uninstall  " + text.bold + text.green + "✓" + text.none + "      application name             none           \n      unpublish  " + text.bold + text.green + "✓" + text.none + "      application name             none           \n      unzip      " + text.bold + text.green + "✓" + text.none + "      path to zip file             directory path \n      zip        " + text.bold + text.green + "✓" + text.none + "      file path or directory path  directory path \n\n" + text.underline + text.bold + text.cyan + "New big Heading" + text.none + "\n  paragraph here to see if indentation is largely reset\n  appropriate to the current heading that is bigger than the\n  previous headings",
                    name         = "biddle_test_markdown_60";
                if (er !== null) {
                    return apps.errout({
                        error : er,
                        name  : name,
                        stdout: stdout,
                        time  : humantime(true)
                    });
                }
                if (stder !== null && stder !== "") {
                    return apps.errout({
                        error : stder,
                        name  : name,
                        stdout: stdout,
                        time  : humantime(true)
                    });
                }
                stdout = stdout
                    .replace(/\r\n/g, "\n")
                    .slice(0, 8192)
                    .replace(/(\s+)$/, "")
                    .replace(/(\\(\w+)?\s*)$/, "");
                if (stdout !== markdowntest) {
                    return diffFiles(name, stdout, markdowntest);
                }
                console.log(humantime(false) + " " + text.green + "markdown 60 test passed." + text.nocolor);
                flag["60"] = true;
                if (flag["80"] === true && flag["120"] === true) {
                    next();
                }
            });
            node.child(childcmd + "markdown " + data.abspath + "test" + node.path.sep + "biddletesta" + node.path.sep + "READMEa.md 80 childtest", {
                cwd: data.abspath
            }, function biddle_test_markdown_80(er, stdout, stder) {
                var markdowntest = "\n" + text.underline + text.bold + text.red + "test README" + text.none + "\nsome dummy subtext\n\n" + text.underline + text.bold + text.cyan + "First Secondary Heading" + text.none + "\n    | a big block quote lives here. This is where I am going to\n    | experience with wrapping a block quote a bit differently from other content.\n    | I need enough text in this quote to wrap a couple of times, so I will\n    | continue adding some nonsense and as long as it takes to ensure I have a\n    | fully qualified test.\n    | New line in a block quote\n    | More block\n\n  This is a regular paragraph that needs to be long enough to wrap a couple\n  times.  This text will be unique from the text in the block quote because\n  uniqueness saves time when debugging test failures.  I am now writing a bunch\n  of wrapping paragraph gibberish, such as f324fasdaowkefsdva.  That one isn't\n  even a word.  It isn't cool if it doesn't contain a hyperlink,\n  (" + text.cyan + "http://tonowhwere.nothing" + text.nocolor + "), in some text.\n\n  " + text.bold + text.red + "*" + text.none + " list item 1 these also need to wrap like a paragraph. So blah blah\n    wrapping some madness into a list item right gosh darn here and let's see\n    what shakes out of the coolness.\n  " + text.bold + text.red + "*" + text.none + " list item 2 these also need to wrap like a paragraph. So blah blah\n    wrapping some madness into a list item right gosh darn here and let's see\n    what shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " sublist item 1 these also need to wrap like a paragraph. So blah\n      blah wrapping some madness into a list item right gosh darn here and let's\n      see what shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " sublist item 2 these also need to wrap like a paragraph. So blah\n      blah wrapping some madness into a list item right gosh darn here and let's\n      see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " subsublist item 1 these also need to wrap like a paragraph.\n        So blah blah wrapping some madness into a list item right gosh darn here\n        and let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " subsublist item 2 these also need to wrap like a paragraph.\n        So blah blah wrapping some madness into a list item right gosh darn here\n        and let's see what shakes out of the coolness.\n  " + text.bold + text.red + "*" + text.none + " list item 3 these also need to wrap like a paragraph. So blah blah\n    wrapping some madness into a list item right gosh darn here and let's see\n    what shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " boo these also need to wrap like a paragraph. So blah blah\n      wrapping some madness into a list item right gosh darn here and let's see\n      what shakes out of the coolness.\n\n  " + text.underline + text.bold + text.green + "First Tertiary Heading" + text.none + "\n    This text should be extra indented.\n\n    " + text.bold + text.red + "*" + text.none + " list item 1\n    " + text.bold + text.red + "*" + text.none + " list item 2\n      " + text.bold + text.red + "-" + text.none + " sublist item 1\n      " + text.bold + text.red + "-" + text.none + " sublist item 2\n        " + text.bold + text.red + "*" + text.none + " subsublist item 1\n        " + text.bold + text.red + "*" + text.none + " subsublist item 2\n    " + text.bold + text.red + "*" + text.none + " list item 3\n      " + text.bold + text.red + "-" + text.none + " boo\n\n    " + text.underline + text.bold + text.yellow + "Gettin Deep with the Headings" + text.none + "\n\n        | a big block quote lives here. This is where I am going\n        | to experience with wrapping a block quote a bit differently from other\n        | content.  I need enough text in this quote to wrap a couple of times, so\n        | I will continue adding some nonsense and as long as it takes to ensure I\n        | have a fully qualified test.\n        | New line in a block quote\n        | More block\n\n      Images get converted to their alt text description.\n\n      This is a regular paragraph that needs to be long enough to wrap a\n      couple times.  This text will be unique from the text in the block quote\n      because uniqueness saves time when debugging test failures.  I am now\n      writing a bunch of wrapping paragraph gibberish, such as\n      f324fasdaowkefsdva.  That one isn't even a word.\n\n      " + text.bold + text.red + "*" + text.none + " list item 1 these also need to wrap like a paragraph. So blah\n        blah wrapping some madness into a list item right gosh darn here and\n        let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " list item 2 these also need to wrap like a paragraph. So blah\n        blah wrapping some madness into a list item right gosh darn here and\n        let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " sublist item 1 these also need to wrap like a paragraph.\n          So blah blah wrapping some madness into a list item right gosh darn\n          here and let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " sublist item 2 these also need to wrap like a paragraph.\n          So blah blah wrapping some madness into a list item right gosh darn\n          here and let's see what shakes out of the coolness.\n          " + text.bold + text.red + "*" + text.none + " subsublist item 1 these also need to wrap like a\n            paragraph. So blah blah wrapping some madness into a list item right\n            gosh darn here and let's see what shakes out of the coolness.\n          " + text.bold + text.red + "*" + text.none + " subsublist item 2 these also need to wrap like a\n            paragraph. So blah blah wrapping some madness into a list item right\n            gosh darn here and let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " list item 3 these also need to wrap like a paragraph. So blah\n        blah wrapping some madness into a list item right gosh darn here and\n        let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " boo these also need to wrap like a paragraph. So blah\n          blah wrapping some madness into a list item right gosh darn here and\n          let's see what shakes out of the coolness.\n\n      " + text.underline + "Command   " + text.normal + text.underline + " Local " + text.normal + text.underline + " Argument Type               " + text.normal + text.underline + " Second Argument " + text.normal + "\n      copy       " + text.bold + text.green + "✓" + text.none + "      file path or directory path  directory path \n      get        " + text.bold + text.yellow + "?" + text.none + "      file path                    none           \n      global     " + text.bold + text.green + "✓" + text.none + "      none                         none           \n      hash       " + text.bold + text.green + "✓" + text.none + "      file path                    none           \n      help       " + text.bold + text.green + "✓" + text.none + "      number                       none           \n      install    " + text.bold + text.yellow + "?" + text.none + "      zip file                     directory path \n      list       " + text.bold + text.green + "✓" + text.none + "      \"" + text.yellow + "installed" + text.nocolor + "\" or \"" + text.yellow + "published" + text.nocolor + "\"   none           \n      markdown   " + text.bold + text.green + "✓" + text.none + "      path to markdown file        number         \n      publish    " + text.bold + text.green + "✓" + text.none + "      directory path               directory path \n      remove     " + text.bold + text.green + "✓" + text.none + "      file path or directory path  none           \n      status     " + text.bold + text.yellow + "?" + text.none + "      none or application name     none           \n      test       " + text.bold + text.red + "X" + text.none + "      none                         none           \n      uninstall  " + text.bold + text.green + "✓" + text.none + "      application name             none           \n      unpublish  " + text.bold + text.green + "✓" + text.none + "      application name             none           \n      unzip      " + text.bold + text.green + "✓" + text.none + "      path to zip file             directory path \n      zip        " + text.bold + text.green + "✓" + text.none + "      file path or directory path  directory path \n\n" + text.underline + text.bold + text.cyan + "New big Heading" + text.none + "\n  paragraph here to see if indentation is largely reset appropriate to the\n  current heading that is bigger than the previous headings",
                    name         = "biddle_test_markdown_80";
                if (er !== null) {
                    return apps.errout({
                        error : er,
                        name  : name,
                        stdout: stdout,
                        time  : humantime(true)
                    });
                }
                if (stder !== null && stder !== "") {
                    return apps.errout({
                        error : stder,
                        name  : name,
                        stdout: stdout,
                        time  : humantime(true)
                    });
                }
                stdout = stdout
                    .replace(/\r\n/g, "\n")
                    .slice(0, 8192)
                    .replace(/(\s+)$/, "")
                    .replace(/(\\(\w+)?\s*)$/, "");
                if (stdout !== markdowntest) {
                    return diffFiles(name, stdout, markdowntest);
                }
                console.log(humantime(false) + " " + text.green + "markdown 80 test passed." + text.nocolor);
                flag["80"] = true;
                if (flag["60"] === true && flag["120"] === true) {
                    next();
                }
            });
            node.child(childcmd + "markdown " + data.abspath + "test" + node.path.sep + "biddletesta" + node.path.sep + "READMEa.md 120 childtest", {
                cwd: data.abspath
            }, function biddle_test_markdown_120(er, stdout, stder) {
                var markdowntest = "\n" + text.underline + text.bold + text.red + "test README" + text.none + "\nsome dummy subtext\n\n" + text.underline + text.bold + text.cyan + "First Secondary Heading" + text.none + "\n    | a big block quote lives here. This is where I am going to experience with wrapping a block quote a bit\n    | differently from other content.  I need enough text in this quote to wrap a couple of times, so I will continue\n    | adding some nonsense and as long as it takes to ensure I have a fully qualified test.\n    | New line in a block quote\n    | More block\n\n  This is a regular paragraph that needs to be long enough to wrap a couple times.  This text will be unique from the\n  text in the block quote because uniqueness saves time when debugging test failures.  I am now writing a bunch of\n  wrapping paragraph gibberish, such as f324fasdaowkefsdva.  That one isn't even a word.  It isn't cool if it doesn't\n  contain a hyperlink, (" + text.cyan + "http://tonowhwere.nothing" + text.nocolor + "), in some text.\n\n  " + text.bold + text.red + "*" + text.none + " list item 1 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list item\n    right gosh darn here and let's see what shakes out of the coolness.\n  " + text.bold + text.red + "*" + text.none + " list item 2 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list item\n    right gosh darn here and let's see what shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " sublist item 1 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list\n      item right gosh darn here and let's see what shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " sublist item 2 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list\n      item right gosh darn here and let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " subsublist item 1 these also need to wrap like a paragraph. So blah blah wrapping some madness into a\n        list item right gosh darn here and let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " subsublist item 2 these also need to wrap like a paragraph. So blah blah wrapping some madness into a\n        list item right gosh darn here and let's see what shakes out of the coolness.\n  " + text.bold + text.red + "*" + text.none + " list item 3 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list item\n    right gosh darn here and let's see what shakes out of the coolness.\n    " + text.bold + text.red + "-" + text.none + " boo these also need to wrap like a paragraph. So blah blah wrapping some madness into a list item right\n      gosh darn here and let's see what shakes out of the coolness.\n\n  " + text.underline + text.bold + text.green + "First Tertiary Heading" + text.none + "\n    This text should be extra indented.\n\n    " + text.bold + text.red + "*" + text.none + " list item 1\n    " + text.bold + text.red + "*" + text.none + " list item 2\n      " + text.bold + text.red + "-" + text.none + " sublist item 1\n      " + text.bold + text.red + "-" + text.none + " sublist item 2\n        " + text.bold + text.red + "*" + text.none + " subsublist item 1\n        " + text.bold + text.red + "*" + text.none + " subsublist item 2\n    " + text.bold + text.red + "*" + text.none + " list item 3\n      " + text.bold + text.red + "-" + text.none + " boo\n\n    " + text.underline + text.bold + text.yellow + "Gettin Deep with the Headings" + text.none + "\n\n        | a big block quote lives here. This is where I am going to experience with wrapping a block\n        | quote a bit differently from other content.  I need enough text in this quote to wrap a couple of times, so I\n        | will continue adding some nonsense and as long as it takes to ensure I have a fully qualified test.\n        | New line in a block quote\n        | More block\n\n      Images get converted to their alt text description.\n\n      This is a regular paragraph that needs to be long enough to wrap a couple times.  This text will be unique\n      from the text in the block quote because uniqueness saves time when debugging test failures.  I am now writing a\n      bunch of wrapping paragraph gibberish, such as f324fasdaowkefsdva.  That one isn't even a word.\n\n      " + text.bold + text.red + "*" + text.none + " list item 1 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list\n        item right gosh darn here and let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " list item 2 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list\n        item right gosh darn here and let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " sublist item 1 these also need to wrap like a paragraph. So blah blah wrapping some madness into\n          a list item right gosh darn here and let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " sublist item 2 these also need to wrap like a paragraph. So blah blah wrapping some madness into\n          a list item right gosh darn here and let's see what shakes out of the coolness.\n          " + text.bold + text.red + "*" + text.none + " subsublist item 1 these also need to wrap like a paragraph. So blah blah wrapping some\n            madness into a list item right gosh darn here and let's see what shakes out of the coolness.\n          " + text.bold + text.red + "*" + text.none + " subsublist item 2 these also need to wrap like a paragraph. So blah blah wrapping some\n            madness into a list item right gosh darn here and let's see what shakes out of the coolness.\n      " + text.bold + text.red + "*" + text.none + " list item 3 these also need to wrap like a paragraph. So blah blah wrapping some madness into a list\n        item right gosh darn here and let's see what shakes out of the coolness.\n        " + text.bold + text.red + "-" + text.none + " boo these also need to wrap like a paragraph. So blah blah wrapping some madness into a list item\n          right gosh darn here and let's see what shakes out of the coolness.\n\n      " + text.underline + "Command   " + text.normal + text.underline + " Local " + text.normal + text.underline + " Argument Type               " + text.normal + text.underline + " Second Argument " + text.normal + "\n      copy       " + text.bold + text.green + "✓" + text.none + "      file path or directory path  directory path \n      get        " + text.bold + text.yellow + "?" + text.none + "      file path                    none           \n      global     " + text.bold + text.green + "✓" + text.none + "      none                         none           \n      hash       " + text.bold + text.green + "✓" + text.none + "      file path                    none           \n      help       " + text.bold + text.green + "✓" + text.none + "      number                       none           \n      install    " + text.bold + text.yellow + "?" + text.none + "      zip file                     directory path \n      list       " + text.bold + text.green + "✓" + text.none + "      \"" + text.yellow + "installed" + text.nocolor + "\" or \"" + text.yellow + "published" + text.nocolor + "\"   none           \n      markdown   " + text.bold + text.green + "✓" + text.none + "      path to markdown file        number         \n      publish    " + text.bold + text.green + "✓" + text.none + "      directory path               directory path \n      remove     " + text.bold + text.green + "✓" + text.none + "      file path or directory path  none           \n      status     " + text.bold + text.yellow + "?" + text.none + "      none or application name     none           \n      test       " + text.bold + text.red + "X" + text.none + "      none                         none           \n      uninstall  " + text.bold + text.green + "✓" + text.none + "      application name             none           \n      unpublish  " + text.bold + text.green + "✓" + text.none + "      application name             none           \n      unzip      " + text.bold + text.green + "✓" + text.none + "      path to zip file             directory path \n      zip        " + text.bold + text.green + "✓" + text.none + "      file path or directory path  directory path \n\n" + text.underline + text.bold + text.cyan + "New big Heading" + text.none + "\n  paragraph here to see if indentation is largely reset appropriate to the current heading that is bigger than the\n  previous headings",
                    name         = "biddle_test_markdown_120";
                if (er !== null) {
                    return apps.errout({
                        error : er,
                        name  : name,
                        stdout: stdout,
                        time  : humantime(true)
                    });
                }
                if (stder !== null && stder !== "") {
                    return apps.errout({
                        error : stder,
                        name  : name,
                        stdout: stdout,
                        time  : humantime(true)
                    });
                }
                stdout = stdout
                    .replace(/\r\n/g, "\n")
                    .slice(0, 8192)
                    .replace(/(\s+)$/, "")
                    .replace(/(\\(\w+)?)$/, "");
                if (stdout !== markdowntest) {
                    return diffFiles(name, stdout, markdowntest);
                }
                console.log(humantime(false) + " " + text.green + "mmarkdown 120 test passed." + text.nocolor);
                flag["120"] = true;
                if (flag["60"] === true && flag["80"] === true) {
                    next();
                }
            });
        };
        phases.moduleInstall = function biddle_test_moduleInstall() {
            var dateobj  = new Date(),
                day      = (dateobj.getDate() > 9)
                    ? "" + dateobj.getDate()
                    : "0" + dateobj.getDate(),
                month    = (dateobj.getMonth() > 8)
                    ? "" + (dateobj.getMonth() + 1)
                    : "0" + (dateobj.getMonth() + 1),
                date     = Number("" + dateobj.getFullYear() + month + day),
                ind      = 0,
                flag     = {
                    apps  : false,
                    jslint: false,
                    modout: false,
                    today : false
                },
                today    = require(data.abspath + "today.js"),
                editions = function biddle_test_moduleInstall_editionsInit() {
                    return;
                },
                handler  = function biddle_test_moduleInstall_handler() {
                    var mod = keys[ind];
                    modules[mod].name = text.green + modules[mod].name + text.nocolor;
                    if (modules[mod].name.length > longname) {
                        longname = modules[mod].name.length;
                    }
                    node
                        .fs
                        .stat(modules[mod].dir, function biddle_test_moduleInstall_handler_stat(erstat, stats) {
                            var add = function biddle_test_moduleInstall_handler_stat_add() {
                                console.log("Adding " + modules[mod].name);
                                node.child("git submodule add " + modules[mod].repo, {
                                    cwd: data.abspath
                                }, function biddle_test_moduleInstall_handler_stat_add_submodule(era, stdouta, stdoutera) {
                                    if (era !== null && era.toString().indexOf("already exists in the index") < 0) {
                                        return apps.errout({
                                            error : era,
                                            name  : "biddle_test_moduleInstall_handler_stat_add_submodule",
                                            stdout: stdouta,
                                            time  : humantime(true)
                                        });
                                    }
                                    if (stdoutera !== null && stdoutera !== "" && stdoutera.indexOf("Cloning into '") < 0 && stdoutera.indexOf("already exists in the index") < 0) {
                                        return apps.errout({
                                            error : stdoutera,
                                            name  : "biddle_test_moduleInstall_handler_stat_add_submodule",
                                            stdout: stdouta,
                                            time  : humantime(true)
                                        });
                                    }
                                    node
                                        .child("git clone " + modules[mod].repo, {
                                            cwd: data.abspath
                                        }, function biddle_test_moduleInstall_handler_stat_add_submodule_clone(erb, stdoutb, stdouterb) {
                                            if (erb !== null) {
                                                return apps.errout({
                                                    error : erb,
                                                    name  : "biddle_test_moduleInstall_handler_stat_add_submodule_clone",
                                                    stdout: stdoutb,
                                                    time  : humantime(true)
                                                });
                                            }
                                            if (stdouterb !== null && stdouterb !== "" && stdouterb.indexOf("Cloning into '") < 0) {
                                                return apps.errout({
                                                    error : stdouterb,
                                                    name  : "biddle_test_moduleInstall_handler_stat_add_submodule_clone",
                                                    stdout: stdoutb,
                                                    time  : humantime(true)
                                                });
                                            }
                                            ind += 1;
                                            editions(mod, true, ind);
                                            return stdoutb;
                                        });
                                    return stdouta;
                                });
                            };
                            if (erstat !== null && erstat !== undefined) {
                                if (erstat.toString().indexOf("Error: ENOENT: no such file or directory, stat '") === 0) {
                                    return add();
                                }
                                return apps.errout({
                                    error: erstat,
                                    name : "biddle_test_moduleInstall_handler_stat",
                                    time : humantime(true)
                                });
                            }
                            if (stats.isDirectory() === true) {
                                return node
                                    .fs
                                    .readdir(modules[mod].dir, function biddle_test_moduleInstall_handler_stat_readdir(direrr, files) {
                                        if (typeof direrr === "string") {
                                            return apps.errout({
                                                error: direrr,
                                                name : "biddle_test_moduleInstall_handler_stat_readdir",
                                                time : humantime(true)
                                            });
                                        }
                                        ind += 1;
                                        if (files.length < 1) {
                                            apps.rmrecurse(modules[mod].dir, add);
                                        } else {
                                            editions(mod, false);
                                        }
                                    });
                            }
                            add();
                        });
                };
            editions = function biddle_test_moduleInstall_editions(appName, cloned) {
                var modout = function biddle_test_moduleInstall_editions_modout() {
                        var x   = 0,
                            len = keys.length;
                        console.log("Installed submodule versions");
                        console.log("----------------------------");
                        for (x = 0; x < len; x += 1) {
                            modules[keys[x]].edition(modules[keys[x]]);
                        }
                        next();
                    },
                    submod = function biddle_test_moduleInstall_editions_submod(output) {
                        var appFile        = modules[appName].dir + node.path.sep + modules[appName].file,
                            jslintcomplete = function biddle_test_moduleInstall_editions_submod_jslintcomplete() {
                                modules.jslint.app = require(appFile);
                                flag.jslint        = true;
                                if (ind === keys.length) {
                                    if (flag.today === true && flag.modout === false) {
                                        modout();
                                    } else {
                                        if (output === true) {
                                            console.log("All submodules configured.");
                                        }
                                        flag.apps = true;
                                    }
                                }
                            };
                        if (appName === "jslint") {
                            node
                                .fs
                                .readFile(appFile, "utf8", function biddle_test_moduleInstall_editions_submod_lintread(erread, data) {
                                    if (erread !== null && erread !== undefined) {
                                        apps.errout({
                                            error: erread,
                                            name : "biddle_test_moduleInstall_editions_lintread",
                                            time : humantime(true)
                                        });
                                    }
                                    if (data.slice(data.length - 30).indexOf("\nmodule.exports = jslint;") < 0) {
                                        data = data + "\nmodule.exports = jslint;";
                                        node
                                            .fs
                                            .writeFile(appFile, data, "utf8", function biddle_test_moduleInstall_editions_submod_lintread_lintwrite(erwrite) {
                                                if (erwrite !== null && erwrite !== undefined) {
                                                    apps.errout({
                                                        error: erwrite,
                                                        name : "biddle_test_moduleInstall_editions_lintread_lintwrite",
                                                        time : humantime(true)
                                                    });
                                                }
                                                jslintcomplete();
                                            });
                                    } else {
                                        jslintcomplete();
                                    }
                                });
                        } else {
                            modules[appName].app = require(appFile);
                            if (ind === keys.length && flag.jslint === true) {
                                if (flag.today === true) {
                                    flag.modout = true;
                                    modout();
                                } else {
                                    if (output === true) {
                                        console.log("All submodules configured.");
                                    }
                                    flag.apps = true;
                                }
                            }
                        }
                    },
                    each   = function biddle_test_moduleInstall_editions_each(val, idx) {
                        appName = val;
                        ind     = idx + 1;
                        submod(false);
                    },
                    update = function biddle_test_moduleInstall_editions_update() {
                        node
                            .child("git submodule update", {
                                cwd: data.abspath
                            }, function biddle_test_moduleInstall_editions_update_child(erd, stdoutd, stdouterd) {
                                if (erd !== null) {
                                    apps.errout({
                                        error : erd,
                                        name  : "biddle_test_moduleInstall_editions_update_child",
                                        stdout: stdoutd,
                                        time  : humantime(true)
                                    });
                                }
                                if (stdouterd !== null && stdouterd !== "" && stdouterd.indexOf("Cloning into '") < 0 && stdouterd.indexOf("From ") !== 0) {
                                    apps.errout({
                                        error : stdouterd,
                                        name  : "biddle_test_moduleInstall_editions_update_child",
                                        stdout: stdoutd,
                                        time  : humantime(true)
                                    });
                                }
                                if (flag.today === false) {
                                    console.log("Submodules downloaded.");
                                }
                                keys.forEach(each);
                            });
                    },
                    pull   = function biddle_test_moduleInstall_editions_pull() {
                        node
                            .child("git submodule foreach git pull origin master", {
                                cwd: data.abspath
                            }, function biddle_test_moduleInstall_editions_pull_child(errpull, stdoutpull, stdouterpull) {
                                if (errpull !== null) {
                                    console.log(errpull);
                                    if (errpull.toString().indexOf("fatal: no submodule mapping found in .gitmodules for path ") > 0) {
                                        console.log("No access to GitHub or .gitmodules is corrupt. Proceeding assuming submodules we" +
                                                "re previously installed.");
                                        flag.apps = true;
                                        return keys.forEach(each);
                                    }
                                    apps.errout({
                                        error : errpull,
                                        name  : "biddle_test_moduleInstall_editions_pull_child",
                                        stdout: stdoutpull,
                                        time  : humantime(true)
                                    });
                                }
                                if (stdouterpull !== null && stdouterpull !== "" && stdouterpull.indexOf("Cloning into '") < 0 && stdouterpull.indexOf("From ") < 0 && stdouterpull.indexOf("fatal: no submodule mapping found in .gitmodules for path ") < 0) {
                                    apps.errout({
                                        error : stdouterpull,
                                        name  : "biddle_test_moduleInstall_editions_pull_child",
                                        stdout: stdoutpull,
                                        time  : humantime(true)
                                    });
                                }
                                if (flag.today === false) {
                                    console.log("Submodules checked for updates.");
                                }
                                keys.forEach(each);
                            });
                    };
                if (ind === keys.length) {
                    if (today !== date) {
                        node
                            .child("git checkout jslint.js", {
                                cwd: data.abspath + "JSLint"
                            }, function biddle_test_moduleInstall_editions_checkoutJSLint(erjsl, stdoutjsl, stdouterjsl) {
                                if (erjsl !== null) {
                                    apps.errout({
                                        error : erjsl,
                                        name  : "biddle_test_moduleInstall_editions_checkoutJSLint",
                                        stdout: stdoutjsl,
                                        time  : humantime(true)
                                    });
                                }
                                if (stdouterjsl !== null && stdouterjsl !== "") {
                                    apps.errout({
                                        error : stdouterjsl,
                                        name  : "biddle_test_moduleInstall_editions_checkoutJSLint",
                                        stdout: stdoutjsl,
                                        time  : humantime(true)
                                    });
                                }
                                ind = 0;
                                node
                                    .fs
                                    .writeFile("today.js", "/\u002aglobal module\u002a/(function () {\"use strict\";var today=" + date + ";module.exports=today;}());",
                                    function biddle_test_moduleInstall_editions_checkoutJSLint_writeToday(werr) {
                                        if (werr !== null && werr !== undefined) {
                                            apps.errout({
                                                error: werr,
                                                name : "biddle_test_moduleInstall_editions_checkoutJSLint_writeToday",
                                                time : humantime(true)
                                            });
                                        }
                                        if (cloned === true) {
                                            console.log("Submodules downloaded.");
                                        } else {
                                            console.log("Submodules checked for updates.");
                                        }
                                        if (flag.apps === true) {
                                            modout();
                                        } else {
                                            console.log("Checked for new versions of submodules.");
                                            flag.today = true;
                                        }
                                    });
                                if (cloned === true) {
                                    node
                                        .child("git submodule init", {
                                            cwd: data.abspath
                                        }, function biddle_test_moduleInstall_editions_checkoutJSLint_init(erc, stdoutc, stdouterc) {
                                            if (erc !== null) {
                                                apps.errout({
                                                    error : erc,
                                                    name  : "biddle_test_moduleInstall_editions_checkoutJSLint_init",
                                                    stdout: stdoutc,
                                                    time  : humantime(true)
                                                });
                                            }
                                            if (stdouterc !== null && stdouterc !== "" && stdouterc.indexOf("Cloning into '") < 0 && stdouterc.indexOf("From ") < 0 && stdouterc.indexOf(" registered for path ") < 0) {
                                                apps.errout({
                                                    error : stdouterc,
                                                    name  : "biddle_test_moduleInstall_editions_checkoutJSLint_init",
                                                    stdout: stdoutc,
                                                    time  : humantime(true)
                                                });
                                            }
                                            update();
                                        });
                                } else {
                                    pull();
                                }
                            });
                    } else {
                        flag.today = true;
                        console.log("Running prior installed modules.");
                        keys.forEach(each);
                    }
                } else {
                    handler(ind);
                }
            };
            apps.rmrecurse(testpath, function biddle_test_moduleInstall_rmrecurse() {
                apps
                    .makedir(testpath, function biddle_test_moduleInstall_rmrecurse_makedir() {
                        handler(0);
                    });
            });
        };
        phases.publish       = function biddle_test_publish() {
            node
                .child(childcmd + "publish " + data.abspath + "test" + node.path.sep + "biddletesta childtest", {
                    cwd: data.abspath
                }, function biddle_test_publish_child(er, stdout, stder) {
                    var bgreen = text.bold + text.green,
                        bcyan = text.bold + text.cyan,
                        publishtest = "File publications/biddletesta/biddlesort.js written at " + bgreen + "xxx" +
                                text.none + " bytes.\nFile publications/biddletesta/biddletesta_" +
                                bcyan + "xxx.zip" + text.none + " written at " + bgreen + "xxx" + text.none +
                                " bytes.\nFile publications/biddletesta/biddletesta_" + bcyan + "l" +
                                "atest.zip" + text.none + " written at " + bgreen + "xxx" + text.none +
                                " bytes.\nFile publications/biddletesta/biddletesta_" + bcyan + "min_xxx.z" +
                                "ip" + text.none + " written at " + bgreen + "xxx" + text.none + " bytes" +
                                ".\nFile publications/biddletesta/biddletesta_" + bcyan + "min_latest.zip" +
                                text.none + " written at " + bgreen + "xxx" + text.none + " bytes." +
                                "\nFile publications/biddletesta/biddletesta_" + bcyan + "prod_xxx.zip" +
                                text.none + " written at " + bgreen + "xxx" + text.none + " bytes." +
                                "\nFile publications/biddletesta/biddletesta_" + bcyan + "prod_latest.zip" +
                                text.none + " written at " + bgreen + "xxx" + text.none + " bytes." +
                                "\nFile publications/biddletesta/filedata.json written at " + bgreen + "xxx" +
                                text.none + " bytes.\nFile publications/biddletesta/index.xhtml written at" +
                                " " + bgreen + "xxx" + text.none + " bytes.\nFile publications/biddletesta" +
                                "/latest.txt written at " + bgreen + "xxx" + text.none + " bytes.",
                        outputs     = stdout
                            .replace(/(\s+)$/, "")
                            .replace("\r\n", "\n")
                            .split("\n")
                            .sort(function biddle_test_publish_child_outSort(a, b) {
                                if (a > b) {
                                    return 1;
                                }
                                return -1;
                            }),
                        output      = "",
                        abspath     = new RegExp(data.abspath.replace(/\\/g, "\\\\"), "g");
                    if (er !== null) {
                        apps.errout({
                            error : er,
                            name  : "biddle_test_publish_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        apps.errout({
                            error : stder,
                            name  : "biddle_test_publish_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    node
                        .fs
                        .stat(data.abspath + "temp",
                        function biddle_test_publish_child_statTemp(errtemp) {
                            if (errtemp === null) {
                                return apps.errout({
                                    error: "Directory 'temp' from publish operation should have been removed.",
                                    name : "biddle_test_publish_child_statTemp",
                                    time : humantime(true)
                                });
                            }
                            if (errtemp.toString().indexOf("no such file or directory") < 0) {
                                return apps.errout({
                                    error: errtemp,
                                    name : "biddle_test_publish_child_statTemp",
                                    time : humantime(true)
                                });
                            }
                            outputs
                                .forEach(function biddle_test_publish_child_statTemp_formatOutput(value, index, array) {
                                    var val = value.slice(value.indexOf("publications"));
                                    array[index] = "File " + val;
                                });
                            output = outputs.join("\n");
                            output = output.replace(/\\/g, "/");
                            output = output
                                .replace(/\d+\.\d+\.\d+\.zip/g, "xxx.zip")
                                .replace(/\u001b\[32m\d+(,\d+)*/g, text.green + "xxx")
                                .replace(abspath, "");
                            if (output !== publishtest) {
                                return diffFiles("biddle_test_publish_child_statTemp", output, publishtest);
                            }
                            console.log(humantime(false) + " " + text.green + "The stdout for publish is correct." + text.nocolor);
                            node
                                .fs
                                .readFile(data.abspath + "published.json",
                                "utf8", function biddle_test_publish_child_statTemp_readJSON(err, fileData) {
                                    var jsondata = {},
                                        pub      = data.abspath + "publications" + node.path.sep + "biddletesta";
                                    if (err !== null && err !== undefined) {
                                        return apps.errout({
                                            error : err,
                                            name  : "biddle_test_publish_child_statTemp_readJSON",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    jsondata = JSON.parse(fileData);
                                    if (jsondata.biddletesta === undefined) {
                                        return apps.errout({
                                            error : "No biddletesta property in published.json file.",
                                            name  : "biddle_test_publish_child_statTemp_readJSON",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    if (jsondata.biddletesta.latest !== "99.99.1234") {
                                        return apps.errout({
                                            error : "biddletesta.latest of published.json is '" + jsondata.biddletesta.latest + "' not '99.99.1234'.",
                                            name  : "biddle_test_publish_child_statTemp_readJSON",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    console.log(humantime(false) + " " + text.green + "File published.json contains biddletesta" + text.nocolor);
                                    node
                                        .fs
                                        .readdir(pub, function biddle_test_publish_child_statTemp_readJSON_readdir(errr, files) {
                                            var filetest = "biddlesort.js,biddletesta_v.hash,biddletesta_v.zip,biddletesta_latest.hash,biddl" +
                                                        "etesta_latest.zip,biddletesta_min_v.hash,biddletesta_min_v.zip,biddletesta_min_l" +
                                                        "atest.hash,biddletesta_min_latest.zip,biddletesta_prod_v.hash,biddletesta_prod_v" +
                                                        ".zip,biddletesta_prod_latest.hash,biddletesta_prod_latest.zip,filedata.json,inde" +
                                                        "x.xhtml,latest.txt",
                                                filelist = files.sort(function biddle_test_publish_child_statTemp_readJSON_readdir_outSort(a, b) {
                                                    if (a > b) {
                                                        return 1;
                                                    }
                                                    return -1;
                                                })
                                                    .join(",")
                                                    .replace(/_\d+\.\d+\.\d+\.((zip)|(hash))/g, function biddle_test_publish_child_statTemp_readJSON_readdir_replace(x) {
                                                        if (x.indexOf("zip") > 0) {
                                                            return "_v.zip";
                                                        }
                                                        return "_v.hash";
                                                    }),
                                                stats    = {},
                                                statfile = function biddle_test_publish_child_statTemp_readJSON_readdir_statfile(index) {
                                                    stats[files[index]] = false;
                                                    node
                                                        .fs
                                                        .stat(pub + node.path.sep + files[index], function biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback(errs, statobj) {
                                                            if (errs !== null) {
                                                                return apps.errout({
                                                                    error : errs,
                                                                    name  : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback",
                                                                    stdout: stdout,
                                                                    time  : humantime(true)
                                                                });
                                                            }
                                                            if (files[index].indexOf(".hash") === files[index].length - 5 && statobj.size !== 128) {
                                                                return apps.errout({
                                                                    error : "Expected hash file " + files[index] + " to be file size 128.",
                                                                    name  : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback",
                                                                    stdout: stdout,
                                                                    time  : humantime(true)
                                                                });
                                                            }
                                                            if (files[index].indexOf(".zip") === files[index].length - 4 && statobj.size > 20000) {
                                                                return apps.errout({
                                                                    error : "Zip file " + files[index] + " is too big at " + apps.commas(statobj.size) + ".",
                                                                    name  : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback",
                                                                    stdout: stdout,
                                                                    time  : humantime(true)
                                                                });
                                                            }
                                                            console.log(humantime(false) + " " + files[index] + " present at size " + apps.commas(statobj.size) + " bytes.");
                                                            stats[files[index]] = true;
                                                            if (stats[files[0]] === true && stats[files[1]] === true && stats[files[2]] === true && stats[files[3]] === true && stats[files[4]] === true && stats[files[5]] === true && stats[files[6]] === true && stats[files[7]] === true && stats[files[8]] === true && stats[files[9]] === true && stats[files[10]] === true && stats[files[11]] === true) {
                                                                console.log(humantime(false) + " " + text.green + "publish test passed." + text.nocolor);
                                                                node.child(childcmd + "publish " + data.abspath + "test" + node.path.sep + "biddletesta childtest", {
                                                                    cwd: data.abspath
                                                                }, function biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish(erx, stdoutx, stderx) {
                                                                    var publishagain = text.bold + text.cyan + "Function:" + text.none + " biddle_publish_execution\n" +
                                                                                     text.bold + text.red + "Error:" + text.none + " Attempted to publish biddletesta over exi" +
                                                                                     "sting version",
                                                                        stack        = [];
                                                                    if (erx !== null) {
                                                                        if (typeof erx.stack === "string") {
                                                                            stack = erx
                                                                                .stack
                                                                                .split(" at ");
                                                                        }
                                                                        if (stack.length < 1 || stack[1].indexOf("ChildProcess.exithandler (child_process.js:2") < 0) {
                                                                            return apps.errout({
                                                                                error : erx,
                                                                                name  : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish",
                                                                                stdout: stdout,
                                                                                time  : humantime(true)
                                                                            });
                                                                        }
                                                                    }
                                                                    if (stderx !== null && stderx !== "") {
                                                                        return apps.errout({
                                                                            error : stderx,
                                                                            name  : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish",
                                                                            stdout: stdout,
                                                                            time  : humantime(true)
                                                                        });
                                                                    }
                                                                    stdoutx = stdoutx
                                                                        .replace("\r\n", "\n")
                                                                        .replace(/(\u0020\d+\.\d+\.\d+\s*)$/, "");
                                                                    if (stdoutx !== publishagain) {
                                                                        return diffFiles("biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish", stdoutx, publishagain);
                                                                    }
                                                                    node
                                                                        .fs
                                                                        .stat(data.abspath + "temp",
                                                                        function biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish_statTemp(errtemp) {
                                                                            if (errtemp === null) {
                                                                                return apps.errout({
                                                                                    error: "Directory 'temp' from publish operation should have been removed.",
                                                                                    name : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish_st" +
                                                                                              "atTemp",
                                                                                    time : humantime(true)
                                                                                });
                                                                            }
                                                                            if (errtemp.toString().indexOf("no such file or directory") < 0) {
                                                                                return apps.errout({
                                                                                    error: errtemp,
                                                                                    name : "biddle_test_publish_child_statTemp_readJSON_readdir_statfile_statback_publish_st" +
                                                                                              "atTemp",
                                                                                    time : humantime(true)
                                                                                });
                                                                            }
                                                                            console.log(humantime(false) + " " + text.green + "Redundant publish test (error messaging) passed." + text.nocolor);
                                                                            next();
                                                                        });
                                                                });
                                                            }
                                                        });
                                                };
                                            if (errr !== null) {
                                                return apps.errout({
                                                    error : errr,
                                                    name  : "biddle_test_publish_child_statTemp_readJSON_readdir",
                                                    stdout: stdout,
                                                    time  : humantime(true)
                                                });
                                            }
                                            if (filelist !== filetest) {
                                                return diffFiles("biddle_test_publish_child_statTemp_readJSON_readdir", filelist, filetest);
                                            }
                                            console.log(humantime(false) + " " + text.green + "List of files generated by publish is correct." + text.nocolor);
                                            statfile(0);
                                            statfile(1);
                                            statfile(2);
                                            statfile(3);
                                            statfile(4);
                                            statfile(5);
                                            statfile(6);
                                            statfile(7);
                                            statfile(8);
                                            statfile(9);
                                            statfile(10);
                                            statfile(11);
                                        });
                                    return stdout;
                                });
                        });
                });
        };
        phases.remove        = function biddle_test_remove() {
            node
                .child(childcmd + "remove " + testpath + node.path.sep + "biddletesta.js childtest", {
                    cwd: data.abspath
                }, function biddle_test_remove_child(er, stdout, stder) {
                    var removefile = testpath + node.path.sep + "biddletesta.js",
                        removetest = "Removed " + removefile;
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_remove_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_remove_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    stdout = stdout.replace(/(\s+)$/, "");
                    if (stdout !== removetest) {
                        return diffFiles("biddle_test_remove_child", stdout, removetest);
                    }
                    node
                        .fs
                        .stat(removefile, function biddle_test_remove_child_stat(ers) {
                            if (ers === null || ers.toString().indexOf("no such file for directory") > 0) {
                                return apps.errout({
                                    error : "remove test failed as file is still present",
                                    name  : "biddle_test_remove_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            console.log(humantime(false) + " " + text.green + "remove test passed." + text.nocolor);
                            next();
                        });
                });
        };
        phases.uninstall     = function biddle_test_uninstall() {
            node
                .child(childcmd + "uninstall biddletesta childtest", {
                    cwd: data.abspath
                }, function biddle_test_uninstall_child(er, stdout, stder) {
                    var uninsttest = "App " + text.cyan + "biddletesta" + text.nocolor + " is uninstalled.";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_uninstall_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_uninstall_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    stdout = stdout.replace(/(\s+)$/, "");
                    if (stdout !== uninsttest) {
                        return diffFiles("biddle_test_uninstall_child", stdout, uninsttest);
                    }
                    if (data.installed.biddletesta !== undefined) {
                        return apps.errout({
                            error : "biddletesta property not removed from data.installed object",
                            name  : "biddle_test_uninstall_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    console.log(humantime(false) + " " + text.green + "biddletesta removed from installed.json." + text.nocolor);
                    node
                        .fs
                        .stat(data.abspath + "applications" + node.path.sep + "biddletesta",
                        function biddle_test_uninstall_child_stat(err, stat) {
                            if (err !== null && err.toString().indexOf("no such file or directory") < 0) {
                                return apps.errout({
                                    error: err,
                                    name : "biddle_test_uninstall_child_stat",
                                    time : humantime(true)
                                });
                            }
                            if (stat !== undefined && stat.isDirectory() === true) {
                                return apps.errout({
                                    error : "applications" + node.path.sep + "biddletesta directory not deleted by uninstall command",
                                    name  : "biddle_test_uninstall_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (err.toString().indexOf("no such file or directory") > 0) {
                                node
                                    .fs
                                    .readFile(data.abspath + "installed.json",
                                    function biddle_test_uninstall_child_stat_readfile(erf, filedata) {
                                        var jsondata = {};
                                        if (erf !== null && erf !== undefined) {
                                            return apps.errout({
                                                error : erf,
                                                name  : "biddle_test_uninstall_child_stat_readfile",
                                                stdout: stdout,
                                                time  : humantime(true)
                                            });
                                        }
                                        jsondata = JSON.parse(filedata);
                                        if (jsondata.biddletesta !== undefined) {
                                            return apps.errout({
                                                error : "biddletesta property still present in installed.json file",
                                                name  : "biddle_test_uninstall_child_stat_readfile",
                                                stdout: stdout,
                                                time  : humantime(true)
                                            });
                                        }
                                        console.log(humantime(false) + " " + text.green + "uninstall test passed." + text.nocolor);
                                        node.child(childcmd + "uninstall biddletesta childtest", {
                                            cwd: data.abspath
                                        }, function biddle_test_uninstall_child_stat_readfile_again(erx, stdoutx, stderx) {
                                            var uninstagain = "Attempted to uninstall " + text.cyan + "biddletesta" + text.nocolor + " which is " +
                                                            text.bold + text.red + "absent" + text.none + " from the list of installed applications. Try using " +
                                                            "the command " + text.green + "biddle list installed" + text.nocolor + ".",
                                                stack       = [];
                                            if (erx !== null) {
                                                if (typeof erx.stack === "string") {
                                                    stack = erx
                                                        .stack
                                                        .split(" at ");
                                                }
                                                if (stack.length < 1 || stack[1].indexOf("ChildProcess.exithandler (child_process.js:202:12)") < 0) {
                                                    return apps.errout({
                                                        error : erx,
                                                        name  : "biddle_test_uninstall_child_stat_readfile_again",
                                                        stdout: stdout,
                                                        time  : humantime(true)
                                                    });
                                                }
                                            }
                                            if (stderx !== null && stderx !== "") {
                                                return apps.errout({
                                                    error : stderx,
                                                    name  : "biddle_test_uninstall_child_stat_readfile_again",
                                                    stdout: stdout,
                                                    time  : humantime(true)
                                                });
                                            }
                                            stdoutx = stdoutx.replace(/(\s+)$/, "");
                                            if (stdoutx !== uninstagain) {
                                                return diffFiles("biddle_test_uninstall_child_stat_readfile_again", stdoutx, uninstagain);
                                            }
                                            console.log(humantime(false) + " " + text.green + "Redundant uninstall test (error messaging) passed." + text.nocolor);
                                            next();
                                        });
                                    });
                            } else {
                                return apps.errout({
                                    error : "directory applications" + node.path.sep + "biddletesta changed to something else and not deleted",
                                    name  : "biddle_test_uninstall_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                        });
                });
        };
        phases.unpublish     = function biddle_test_unpublish() {
            node
                .child(childcmd + "unpublish biddletesta childtest", {
                    cwd: data.abspath
                }, function biddle_test_unpublish_child(er, stdout, stder) {
                    var unpubtest = "App " + text.cyan + "biddletesta" + text.nocolor + " is unpublished.";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_unpublish_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_unpublish_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    stdout = stdout.replace(/(\s+)$/, "");
                    if (stdout !== unpubtest) {
                        return diffFiles("biddle_test_unpublish_child", stdout, unpubtest);
                    }
                    if (data.published.biddletesta !== undefined) {
                        return apps.errout({
                            error : "biddletesta property not removed from data.published object",
                            name  : "biddle_test_unpublish_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    console.log(humantime(false) + " " + text.green + "biddletesta removed from published.json." + text.nocolor);
                    node
                        .fs
                        .stat(data.abspath + "publications" + node.path.sep + "biddletesta",
                        function biddle_test_unpublish_child_stat(err, stat) {
                            if (err !== null && err.toString().indexOf("no such file or directory") < 0) {
                                return apps.errout({
                                    error: err,
                                    name : "biddle_test_unpublish_child_stat",
                                    time : humantime(true)
                                });
                            }
                            if (stat !== undefined && stat.isDirectory() === true) {
                                return apps.errout({
                                    error : "publications" + node.path.sep + "biddletesta directory not deleted by unpublish command",
                                    name  : "biddle_test_unpublish_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (err.toString().indexOf("no such file or directory") > 0) {
                                node
                                    .fs
                                    .readFile(data.abspath + "published.json",
                                    function biddle_test_unpublish_child_stat_readfile(erf, filedata) {
                                        var jsondata = {};
                                        if (erf !== null && erf !== undefined) {
                                            return apps.errout({
                                                error : erf,
                                                name  : "biddle_test_unpublish_child_stat_readfile",
                                                stdout: stdout,
                                                time  : humantime(true)
                                            });
                                        }
                                        jsondata = JSON.parse(filedata);
                                        if (jsondata.biddletesta !== undefined) {
                                            return apps.errout({
                                                error : "biddletesta property still present in published.json file",
                                                name  : "biddle_test_unpublish_child_stat_readfile",
                                                stdout: stdout,
                                                time  : humantime(true)
                                            });
                                        }
                                        console.log(humantime(false) + " " + text.green + "unpublish test passed." + text.nocolor);
                                        node.child(childcmd + "unpublish biddletesta childtest", {
                                            cwd: data.abspath
                                        }, function biddle_test_unpublish_child_stat_readfile_again(erx, stdoutx, stderx) {
                                            var unpubagain = "Attempted to unpublish " + text.cyan + "biddletesta" + text.nocolor + " which is " +
                                                           text.bold + text.red + "absent" + text.none + " from the list of published applications. Try using " +
                                                           "the command " + text.green + "biddle list published" + text.nocolor + ".",
                                                stack      = [];
                                            if (erx !== null) {
                                                if (typeof erx.stack === "string") {
                                                    stack = erx
                                                        .stack
                                                        .split(" at ");
                                                }
                                                if (stack.length < 1 || stack[1].indexOf("ChildProcess.exithandler (child_process.js:202:12)") < 0) {
                                                    return apps.errout({
                                                        error : erx,
                                                        name  : "biddle_test_unpublish_child_stat_readfile_again",
                                                        stdout: stdout,
                                                        time  : humantime(true)
                                                    });
                                                }
                                            }
                                            if (stderx !== null && stderx !== "") {
                                                return apps.errout({
                                                    error : stderx,
                                                    name  : "biddle_test_unpublish_child_stat_readfile_again",
                                                    stdout: stdout,
                                                    time  : humantime(true)
                                                });
                                            }
                                            stdoutx = stdoutx.replace(/(\s+)$/, "");
                                            if (stdoutx !== unpubagain) {
                                                return diffFiles("biddle_test_unpublish_child_stat_readfile_again", stdoutx, unpubagain);
                                            }
                                            console.log(humantime(false) + " " + text.green + "Redundant unpublish test (error messaging) passed." + text.nocolor);
                                            next();
                                        });
                                    });
                            } else {
                                return apps.errout({
                                    error : "directory publications" + node.path.sep + "biddletesta changed to something else and not deleted",
                                    name  : "biddle_test_unpublish_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                        });
                });
        };
        phases.unzip         = function biddle_test_unzip() {
            node
                .child(childcmd + "unzip " + data.abspath + "unittest" + node.path.sep + "biddletesta.zip " + data.abspath + "unittest" + node.path.sep + "unzip childtest", {
                    cwd: data.abspath
                }, function biddle_test_unzip_child(er, stdout, stder) {
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_unzip_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_unzip_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    node
                        .fs
                        .stat(testpath + node.path.sep + "unzip" + node.path.sep + "biddletesta.js",
                        function biddle_test_unzip_child_stat(err, stat) {
                            if (err !== null) {
                                return apps.errout({
                                    error : err,
                                    name  : "biddle_test_unzip_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (stat.size < 10000) {
                                return apps.errout({
                                    error : text.red + "unzip test failed." + text.nocolor,
                                    name  : "biddle_test_unzip_child_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            console.log(humantime(false) + " " + text.green + "biddletesta.js unzipped." + text.nocolor);
                            node
                                .fs
                                .readdir(testpath + node.path.sep + "unzip",
                                function biddle_test_unzip_child_stat_readDir(erd, files) {
                                    var count = 5;
                                    if (erd !== null) {
                                        return apps.errout({
                                            error : erd,
                                            name  : "biddle_test_unzip_child_stat_readDir",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    if (files.length !== count) {
                                        return apps.errout({
                                            error : "Expected " + count + " items unzipped, but there are " + files.length + ".",
                                            name  : "biddle_test_unzip_child_stat_readDir",
                                            stdout: stdout,
                                            time  : humantime(true)
                                        });
                                    }
                                    console.log(humantime(false) + " " + text.green + count + " items unzipped." + text.nocolor);
                                    console.log(humantime(false) + " " + text.green + "unzip test passed." + text.nocolor);
                                    next();
                                });
                            return stdout;
                        });
                });
        };
        phases.zip           = function biddle_test_zip() {
            node
                .child(childcmd + "zip " + data.abspath + "test" + node.path.sep + "biddletesta " + data.abspath + "unittest childtest", {
                    cwd: data.abspath
                }, function biddle_test_zip_child(er, stdout, stder) {
                    var ziptest = "Zip file written: unittest" + node.path.sep + "biddletesta.zip";
                    if (er !== null) {
                        return apps.errout({
                            error : er,
                            name  : "biddle_test_zip_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    if (stder !== null && stder !== "") {
                        return apps.errout({
                            error : stder,
                            name  : "biddle_test_zip_child",
                            stdout: stdout,
                            time  : humantime(true)
                        });
                    }
                    stdout = stdout
                        .replace(/(\s+)$/, "")
                        .replace(data.abspath, "");
                    if (stdout !== ziptest) {
                        return diffFiles("biddle_test_zip_child", stdout, ziptest);
                    }
                    node
                        .fs
                        .stat(testpath + node.path.sep + "biddletesta.zip",
                        function biddle_test_zip_stat(err, stat) {
                            if (err !== null) {
                                return apps.errout({
                                    error : err,
                                    name  : "biddle_test_zip_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            if (stat.size > 20000) {
                                return apps.errout({
                                    error : "Zip file is too large at " + apps.commas(stat.size) + " bytes.",
                                    name  : "biddle_test_zip_stat",
                                    stdout: stdout,
                                    time  : humantime(true)
                                });
                            }
                            console.log(humantime(false) + " " + text.green + "zip test passed." + text.nocolor + " File " + data.abspath + "unittest" + node.path.sep + "biddletesta.zip written at " + apps.commas(stat.size) + " bytes.");
                            next();
                        });
                });
        };
        next();
    };
    apps.uninstall   = function biddle_uninstall(fromTest) {
        var app = data.installed[data.input[2]];
        if (app === undefined && fromTest === false) {
            return console.log("Attempted to uninstall " + text.cyan + data.input[2] + text.nocolor + " which is " + text.bold + text.red + "absent" + text.none + " from the list o" +
                    "f installed applications. Try using the command " + text.green + "biddle list installed" +
                    text.nocolor + ".");
        }
        if (fromTest === true) {
            delete data.installed.biddletestb;
            apps.rmrecurse(data.abspath + "applications" + node.path.sep + "biddletestb",
            function biddle_uninstall_removeTest() {
                return true;
            });
        }
        apps
            .rmrecurse(app.location, function biddle_uninstall_rmrecurse() {
                var str = "",
                    loc = app.location;
                delete data.installed[data.input[2]];
                str = JSON.stringify(data.installed);
                apps.writeFile(str, data.abspath + "installed.json",
                function biddle_uninstall_rmrecurse_writeFile() {
                    data.input[3] = "remove";
                    if (data.platform !== "win32") {
                        apps.global(loc + node.path.sep);
                    }
                    if (fromTest === false) {
                        console.log("App " + text.cyan + data.input[2] + text.nocolor + " is uninstalled.");
                    }
                });
            });
    };
    apps.unpublish   = function biddle_unpublish(fromTest) {
        var app = data.published[data.input[2]];
        if (app === undefined && fromTest === false) {
            return console.log("Attempted to unpublish " + text.cyan + data.input[2] + text.nocolor + " which is " + text.bold + text.red + "absent" + text.none + " from the list o" +
                    "f published applications. Try using the command " + text.green + "biddle list published" +
                    text.nocolor + ".");
        }
        if (fromTest === true) {
            delete data.published.biddletestb;
            apps.rmrecurse(data.abspath + "publications" + node.path.sep + "biddletestb",
            function biddle_unpublish_removeTest() {
                return true;
            });
        }
        apps
            .rmrecurse(app.directory, function biddle_unpublish_rmrecurse() {
                var str = "";
                delete data.published[data.input[2]];
                str = JSON.stringify(data.published);
                apps.writeFile(str, data.abspath + "published.json",
                function biddle_unpublish_rmrecurse_writeFile() {
                    if (fromTest === false) {
                        console.log("App " + text.cyan + data.input[2] + text.nocolor + " is unpublished.");
                    }
                });
            });
    };
    apps.writeFile   = function biddle_writeFile(fileData, fileName, callback) {
        var callbacker = function biddle_writeFile_callbacker(size) {
                var colored = [];
                if (size > 0 && fileName.replace(data.abspath, "") !== "published.json" && fileName.replace(data.abspath, "") !== "installed.json") {
                    colored                     = fileName.split(node.path.sep);
                    colored[colored.length - 1] = colored[colored.length - 1].replace("_", "_" + text.bold + text.cyan);
                    if ((/((\.zip)|(\.hash))$/).test(fileName) === true) {
                        console.log("File " + colored.join(node.path.sep) + text.none + " written at " + text.bold + text.green + apps.commas(size) + text.none + " bytes.");
                    } else {
                        console.log("File " + colored.join(node.path.sep) + " written at " + text.bold + text.green + apps.commas(size) + text.none + " bytes.");
                    }
                }
                callback(fileData);
            },
            encoding = ((data.command !== "install" && (/[\u0002-\u0008]|[\u000e-\u001f]/).test(fileData) === true) || (/(\.zip)$/).test(fileName) === true)
                ? "binary"
                : "utf8";
        node
            .fs
            .writeFile(fileName, fileData, encoding, function biddle_writeFile_callback(err) {
                if (err !== null) {
                    if (data.platform !== "win32" && data.command === "global" && err.toString().indexOf("EACCES: permission denied")) {
                        return apps.errout({
                            error: err.toString() + "\n" + text.bold + text.red + "This command requires sudo access." + text.none + " Pleas" +
                                    "e try 'sudo node biddle global'.",
                            name : "biddle_writeFile_callback"
                        });
                    }
                    return apps.errout({
                        error: err,
                        name : "biddle_writeFile_callback"
                    });
                }
                if (data.command === "get" || data.command === "publish") {
                    if (data.command === "publish") {
                        fileName = fileName.replace(".hash", ".zip");
                    }
                    node
                        .fs
                        .stat(fileName, function biddle_writeFile_callback_getstat(errstat, stat) {
                            if (errstat !== null) {
                                return apps.errout({
                                    error: errstat,
                                    name : "biddle_writeFile_callback_getstat"
                                });
                            }
                            callbacker(stat.size);
                        });
                } else {
                    callbacker(0);
                }
            });
    };
    apps.zip         = function biddle_zip(callback, zippack) {
        var zipfile     = "",
            latestfile  = "",
            cmd         = "",
            latestcmd   = "",
            zipdir      = "",
            variantName = (zippack.name === "")
                ? ""
                : "_" + apps.sanitizef(zippack.name),
            childfunc   = function biddle_zip_childfunc(zipfilename, zipcmd, writejson) {
                node
                    .child(zipcmd, {
                        cwd: zipdir
                    }, function biddle_zip_childfunc_child(err, stdout, stderr) {
                        if (err !== null && stderr.toString().indexOf("No such file or directory") < 0) {
                            return apps.errout({
                                error: err,
                                name : "biddle_zip_childfunc_child"
                            });
                        }
                        if (stderr !== null && stderr.replace(/\s+/, "") !== "" && stderr.indexOf("No such file or directory") < 0) {
                            return apps.errout({
                                error: stderr,
                                name : "biddle_zip_childfunc_child"
                            });
                        }
                        if (data.command === "install") {
                            node
                                .fs
                                .readFile(data.address.target + "package.json",
                                function biddle_zip_childfunc_child_install(erf, filedata) {
                                    if (erf !== null && erf !== undefined) {
                                        return apps.errout({
                                            error: erf,
                                            name : "biddle_zip_childfunc_child_install"
                                        });
                                    }
                                    data.packjson = JSON.parse(filedata);
                                    callback(zipfilename, writejson);
                                });
                        } else {
                            callback(zipfilename, writejson);
                        }
                        return stdout;
                    });
            };
        if (data.command === "publish" || data.command === "zip") {
            if (data.command === "zip") {
                zipfile = data.address.target + data.fileName + ".zip";
            } else {
                zipfile = data.address.target + data.packjson.name + variantName + "_" + apps.sanitizef(data.packjson.version) + ".zip";
            }
            if (data.command === "publish") {
                cmd = cmds.zip(zipfile, "");
                apps.makedir(data.address.target, function biddle_zip_makepubdir() {
                    zipdir = zippack.location;
                    if (data.latestVersion === true) {
                        latestfile = zipfile.replace(data.packjson.version + ".zip",
                        "latest.zip");
                        latestcmd  = cmd.replace(data.packjson.version + ".zip",
                        "latest.zip");
                        childfunc(latestfile, latestcmd, false);
                    }
                    childfunc(zipfile, cmd, true);
                });
            } else {
                node
                    .fs
                    .stat(data.input[2], function biddle_zip_stat(ers, stats) {
                        if (ers !== null) {
                            return apps.errout({
                                error: ers,
                                name : "biddle_zip_stat"
                            });
                        }
                        if (stats.isDirectory() === true) {
                            cmd = cmds.zip(zipfile, "");
                            apps.makedir(data.input[2], function biddle_zip_stat_makedir() {
                                zipdir = data.input[2];
                                childfunc(zipfile, cmd, false);
                            });
                        } else {
                            zipdir = (function biddle_zip_stat_zipdir() {
                                var dirs = data
                                    .input[2]
                                    .split(node.path.sep);
                                cmd = cmds.zip(zipfile, dirs.pop());
                                return apps.relToAbs(dirs.join(node.path.sep), data.cwd);
                            }());
                            childfunc(zipfile, cmd, false);
                        }
                    });
            }
        }
        if (data.command === "install" || data.command === "unzip") {
            if (data.command === "install") {
                var fileName = (function biddle_zip_fileName() {
                    var sep = ((/^(https?:\/\/)/).test(data.input[2]) === true)
                        ? "/"
                        : node.path.sep;
                    return data
                        .input[2]
                        .split(sep)
                        .pop();
                }());
                cmd = cmds.unzip(data.address.downloads + fileName);
            } else {
                cmd = cmds.unzip(data.input[2]);
            }
            apps.makedir(data.address.target, function biddle_zip_unzip() {
                childfunc(data.input[2], cmd, false);
            });
        }
    };
    (function biddle_init() {
        var status    = {
                biddlerc : false,
                installed: false,
                published: false
            },
            valuetype = "",
            start     = function biddle_init_start() {
                (function biddle_init_start_target() {
                    var dir = [],
                        app = "";
                    if (typeof data.input[3] === "string") {
                        data.address.target = apps.relToAbs(data.input[3].replace(/((\\|\/)+)$/, ""), data.cwd) + node.path.sep;
                    } else if (data.command === "publish") {
                        data.address.target = data.address.publications;
                    } else if (data.command === "install") {
                        dir                 = ((/^(https?:\/\/)/i).test(data.input[2]) === true)
                            ? data
                                .input[2]
                                .split("/")
                            : data
                                .input[2]
                                .split(node.path.sep);
                        app                 = dir[dir.length - 1];
                        data.address.target = data.address.applications + apps.sanitizef(app.slice(0, app.indexOf("_"))) + node.path.sep;
                    } else {
                        data.address.target = data.address.downloads;
                    }
                }());
                if (data.command === "help" || data.command === "" || data.command === undefined || data.command === "?") {
                    apps.markdown();
                } else if (isNaN(data.command) === false) {
                    data.input[1] = "markdown";
                    data.input[2] = data.command;
                    data.command  = "markdown";
                    apps.markdown();
                } else if (commands[data.command] === undefined) {
                    apps.errout({
                        error: "Unrecognized command: " + text.red + data.command + text.nocolor + ".  Currently these commands are recognized:\r\n\r\n" + Object
                            .keys(commands)
                            .join("\r\n") + "\r\n",
                        name : "biddle_init_start"
                    });
                } else {
                    if (data.input[2] === undefined && data.command !== "commands" && data.command !== "global" && data.command !== "list" && data.command !== "status" && data.command !== "test") {
                        if (data.command === "copy" || data.command === "hash" || data.command === "markdown" || data.command === "remove" || data.command === "unzip" || data.command === "zip") {
                            valuetype = "path to a local file or directory";
                        } else if (data.command === "get" || data.command === "install" || data.command === "publish") {
                            valuetype = "URL address for a remote resource or path to a local file";
                        } else if (data.command === "uninstall" || data.command === "unpublish") {
                            valuetype = "known application name";
                        }
                        return apps.errout({
                            error: "Command " + text.green + data.command + text.nocolor + " requires a " + valuetype + ".",
                            name : "biddle_init_start"
                        });
                    }
                    if (data.input[3] === undefined && data.command === "copy") {
                        return apps.errout({
                            error: "Command " + text.green + data.command + text.nocolor + " requires a destination directory.",
                            name : "biddle_init_start"
                        });
                    }
                    if (data.command === "commands") {
                        apps.commands();
                    } else if (data.command === "copy") {
                        apps
                            .copy(data.input[2], data.input[3], [], function biddle_init_start_copy() {
                                return true;
                            });
                    } else if (data.command === "get") {
                        apps
                            .get(data.input[2], function biddle_init_start_getback(filedata) {
                                apps
                                    .writeFile(filedata, data.address.target + data.fileName, function biddle_init_start_getback_callback() {
                                        return filedata;
                                    });
                            });
                    } else if (data.command === "global") {
                        apps.global(data.abspath);
                    } else if (data.command === "hash") {
                        apps
                            .hash(data.input[2], "hashFile", function biddle_init_start_hash() {
                                console.log(data.hashFile);
                            });
                    } else if (data.command === "install") {
                        apps.install();
                    } else if (data.command === "list") {
                        apps.list();
                    } else if (data.command === "markdown") {
                        apps.markdown();
                    } else if (data.command === "publish") {
                        apps.publish();
                    } else if (data.command === "remove") {
                        apps
                            .rmrecurse(data.input[2], function biddle_init_stat_remove() {
                                console.log("Removed " + apps.relToAbs(data.input[2], data.cwd));
                            });
                    } else if (data.command === "status") {
                        apps.status();
                    } else if (data.command === "test") {
                        apps.test();
                    } else if (data.command === "uninstall") {
                        apps.uninstall(false);
                    } else if (data.command === "unpublish") {
                        apps.unpublish(false);
                    } else if (data.command === "unzip") {
                        apps
                            .zip(function biddle_init_start_unzip(zipfile) {
                                return console.log("File " + zipfile + " unzipped to: " + data.address.target);
                            }, {
                                location: apps.relToAbs(data.input[2], data.cwd),
                                name    : ""
                            });
                    } else if (data.command === "zip") {
                        apps
                            .zip(function biddle_init_start_zip(zipfile) {
                                return console.log("Zip file written: " + zipfile);
                            }, {
                                location: apps.relToAbs(data.input[2], data.cwd),
                                name    : ""
                            });
                    }
                }
            };
        data.input                = (function biddle_input() {
            var a     = [],
                b     = 0,
                c     = process.argv.length,
                paths = [];
            if (process.argv[0] === "sudo") {
                process
                    .argv
                    .splice(0, 1);
                data.sudo = true;
            }
            paths = process
                .argv[0]
                .split(node.path.sep);
            if (paths[paths.length - 1] === "node" || paths[paths.length - 1] === "node.exe") {
                b = 1;
            }
            do {
                a.push(process.argv[b]);
                b += 1;
            } while (b < c);
            if (a.length < 1) {
                a = [
                    "",
                    "",
                    ""
                ];
            }
            a[0] = a[0].toLowerCase();
            if (a[a.length - 1] === "childtest") {
                a.pop();
                data.childtest = true;
            }
            return a;
        }());
        data.command              = (data.input.length > 1)
            ? data
                .input[1]
                .toLowerCase()
            : "";
        data.abspath              = (function biddle_abspath() {
            var absarr = data
                .input[0]
                .split(node.path.sep);
            absarr.pop();
            if (absarr[absarr.length - 1] === "bin") {
                absarr.pop();
            }
            if (absarr[absarr.length - 1] !== "biddle") {
                absarr.push("biddle");
            }
            return absarr.join(node.path.sep) + node.path.sep;
        }());
        data.fileName             = apps.getFileName();
        data.platform             = process
            .platform
            .replace(/\s+/g, "")
            .toLowerCase();
        data.address.applications = data.abspath + "applications" + node.path.sep;
        data.address.downloads    = data.abspath + "downloads" + node.path.sep;
        data.address.publications = data.abspath + "publications" + node.path.sep;
        node
            .fs
            .readFile(data.abspath + "installed.json",
            "utf8", function biddle_init_installed(err, fileData) {
                var parsed = {};
                if (err !== null && err !== undefined) {
                    return apps.errout({
                        error: err,
                        name : "biddle_init_installed"
                    });
                }
                if (fileData !== "") {
                    parsed = JSON.parse(fileData);
                }
                data.installed   = parsed;
                status.installed = true;
                if (status.published === true && status.biddlerc === true) {
                    start();
                }
            });
        node
            .fs
            .readFile(data.abspath + "published.json",
            "utf8", function biddle_init_published(err, fileData) {
                var parsed = {};
                if (err !== null && err !== undefined) {
                    return apps.errout({
                        error: err,
                        name : "biddle_init_published"
                    });
                }
                if (fileData !== "") {
                    parsed = JSON.parse(fileData);
                }
                data.published   = parsed;
                status.published = true;
                if (status.installed === true && status.biddlerc === true) {
                    start();
                }
            });
        if (data.command === "get" || data.command === "install" || data.command === "publish") {
            (function biddle_init_biddlerc() {
                var rcpath = (data.command === "publish")
                    ? apps.relToAbs(data.input[2].replace(/((\/|\\)+)$/, ""), data.cwd) + node.path.sep + ".biddlerc"
                    : process.cwd() + node.path.sep + ".biddlerc";
                node
                    .fs
                    .readFile(rcpath, "utf8", function biddle_init_biddlerc_readFile(err, fileData) {
                        var parsed = {},
                            dirs   = function biddle_init_biddlerc_dirs(type) {
                                if (typeof parsed.directories[type] === "string") {
                                    if (parsed.directories[type].length > 0) {
                                        if (data.command === "publish") {
                                            data.address[type] = apps.relToAbs(parsed.directories[type], apps.relToAbs(data.input[2], data.cwd)) + node.path.sep;
                                        } else {
                                            data.address[type] = apps.relToAbs(parsed.directories[type], data.abspath) + node.path.sep;
                                        }
                                        data
                                            .ignore
                                            .push(parsed.directories[type]);
                                        return;
                                    }
                                }
                            };
                        if (err !== null && err !== undefined) {
                            if (err.toString().indexOf("no such file or directory") > 0) {
                                status.biddlerc = true;
                                if (status.installed === true && status.published === true) {
                                    start();
                                }
                                return;
                            }
                            return apps.errout({
                                error: err,
                                name : "biddle_init_biddlerc_readFile"
                            });
                        }
                        if (fileData !== "") {
                            parsed = JSON.parse(fileData);
                        }
                        dirs("applications");
                        dirs("downloads");
                        dirs("publications");
                        if (typeof parsed.exclusions === "object" && parsed.exclusions.length > 0) {
                            parsed
                                .exclusions
                                .forEach(function biddle_init_biddlerc_readFile_exclusions(value) {
                                    data
                                        .ignore
                                        .push(value.replace(/\\|\//g, node.path.sep));
                                });
                            data
                                .ignore
                                .push(".biddlerc");
                        }
                        status.biddlerc = true;
                        if (status.installed === true && status.published === true) {
                            start();
                        }
                    });
            }());
        } else {
            status.biddlerc = true;
            if (status.installed === true && status.published === true) {
                start();
            }
        }
    }());
}());
