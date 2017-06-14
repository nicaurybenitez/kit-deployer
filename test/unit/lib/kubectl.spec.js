"use strict"

const chai = require("chai");
const expect = chai.expect;
const Kubectl = require("../../../src/lib/kubectl");
const Manifests = require("../../../src/lib/manifests");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

var manifests = new Manifests();

describe("Kubectl", () => {
	var kubectl, cwd;
	beforeEach(() => {
		cwd = path.join(__dirname, "kubectl");
		const kubeconfigFile = path.join(cwd, "example-kubeconfig.yaml");
		const rawKubeconfig = fs.readFileSync(kubeconfigFile, "utf8");
		const kubeconfig = yaml.safeLoad(rawKubeconfig);
		kubectl = new Kubectl({
			cwd: cwd,
			kubeconfig: kubeconfig,
			kubeconfigFile: kubeconfigFile
		});
	});

	describe("Constructor", () => {
		it("should construct without error", () => {
			expect(kubectl).to.exist;
		});
	});

	describe("Get", () => {
		manifests.supportedTypes.forEach((resource) => {
			it("should emit request get event for " + resource, (done) => {
				kubectl.on("request", (args) => {
					expect(args.method).to.equal("get");
					expect(args.resource).to.equal(resource);
					expect(args.name).to.equal("resource-name");
					done();
				});
				// The ones that aren't supported will fallback to using spawn (kubectl binary)
				kubectl.on("spawn", (args) => {
					expect(args[0]).to.equal("get");
					done();
				});
				kubectl.get(resource, "resource-name").catch(() => {});
			});
			it("should only error on address " + resource, (done) => {
				kubectl.get(resource, "resource-name").catch((err) => {
					expect(err.message).to.contain("127.0.0.1:8080");
					done();
				});
			});
		});
	});

	describe("Create", () => {
		it("should emit spawn create event", (done) => {
			kubectl.on("spawn", (args) => {
				expect(args[0]).to.equal("create");
				done();
			});
			kubectl.create(path.join(cwd, "example-namespace.yaml")).catch(() => {});
		});
	});
	describe("Spawn", () => {
		it("should emit spawn event", (done) => {
			kubectl.on("spawn", (args) => {
				expect(args[0]).to.equal("help");
				done();
			});
			kubectl.spawn(["help"]);
		});
		it("should run without error", (done) => {
			kubectl.spawn(["help"], done);
		});
	});
});