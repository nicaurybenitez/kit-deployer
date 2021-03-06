"use strict";

const _ = require("lodash");
const chai = require("chai");
const expect = chai.expect;
const Annotator = require("../../../src/lib/annotator/annotator");
const Annotations = require("../../../src/lib/annotator/annotations");
const Strategy = require("../../../src/lib/strategy").Strategy;
const Strategies = require("../../../src/lib/strategy").Strategies;

describe("Annotator", () => {
  describe("Create New missing strategy", () => {
    it("should NOT be cool no strategy", () => {
      const options = {
        strategy: new Strategy(Strategies.RollingUpdate, {})
      };
      let fn = () => {
        new Annotator(options);
      };
      expect(fn).to.throw;
    });
  });
  describe("Create New", () => {
    let annotator;
    const originalManifest = {
      kind: "Deployment",
      metadata: {
        name: "manifest-deployment",
        labels: {
          name: "manifest-deployment"
        }
      },
      spec: {
        selector: {
          matchLabels: {
            name: "manifest-deployment"
          }
        }
      }
    };
    const originalJobManifest = {
      kind: "Job",
      metadata: {
        name: "manifest-job"
      }
    };
    const options = {
      uuid: "dafbe5ac-f687-4b19-ba23-8fa91f84fbb8",
      sha: "e05a1d976d3e5b5b42a4068b0f34be756cbd5f2a",
      strategy: new Strategy(Strategies.RollingUpdate, {})
    };
    beforeEach(() => {
      annotator = new Annotator(options);
    });
    it("should be cool with it", () => {
      expect(annotator.options.sha).to.equal(options.sha);
    });
    describe("and calling annotate on deployment", () => {
      it("should set the expected annotations", () => {
        const manifest = annotator.annotate(_.cloneDeep(originalManifest));
        expect(manifest.metadata.name).to.equal(originalManifest.metadata.name);
        expect(manifest.metadata.annotations[Annotations.UUID]).to.equal(
          options.uuid
        );
        expect(
          manifest.metadata.annotations[Annotations.OriginalName]
        ).to.equal(originalManifest.metadata.name);
        expect(
          manifest.metadata.annotations[Annotations.LastAppliedConfiguration]
        ).to.equal(JSON.stringify(originalManifest));
        expect(
          manifest.metadata.annotations[
            Annotations.LastAppliedConfigurationHash
          ]
        ).to.equal("5fe441d20dd25a28df2c84667aa9e611df83a6c3");
        expect(manifest.metadata.annotations[Annotations.Commit]).to.equal(
          JSON.stringify(options.sha)
        );
      });
    });
    describe("and calling annotate on job", () => {
      it("should set the expected annotations", () => {
        const manifest = annotator.annotate(_.cloneDeep(originalJobManifest));
        expect(manifest.metadata.name).to.equal(
          originalJobManifest.metadata.name +
            "-f94274f6bdc905825d1616fe265bc6d2de773e7c"
        );
        expect(manifest.metadata.annotations[Annotations.UUID]).to.equal(
          options.uuid
        );
        expect(
          manifest.metadata.annotations[Annotations.OriginalName]
        ).to.equal(originalJobManifest.metadata.name);
        expect(
          manifest.metadata.annotations[Annotations.LastAppliedConfiguration]
        ).to.equal(JSON.stringify(originalJobManifest));
        expect(
          manifest.metadata.annotations[
            Annotations.LastAppliedConfigurationHash
          ]
        ).to.equal("f94274f6bdc905825d1616fe265bc6d2de773e7c");
        expect(manifest.metadata.annotations[Annotations.Commit]).to.equal(
          JSON.stringify(options.sha)
        );
      });
    });
  });

  describe("Create New without UUID", () => {
    let annotator;
    const originalManifest = {
      kind: "Deployment",
      metadata: {
        name: "manifest-deployment",
        labels: {
          name: "manifest-deployment"
        }
      },
      spec: {
        selector: {
          matchLabels: {
            name: "manifest-deployment"
          }
        }
      }
    };
    const originalJobManifest = {
      kind: "Job",
      metadata: {
        name: "manifest-job"
      }
    };
    const options = {
      sha: "e05a1d976d3e5b5b42a4068b0f34be756cbd5f2a",
      strategy: new Strategy(Strategies.RollingUpdate, {})
    };
    beforeEach(() => {
      annotator = new Annotator(options);
    });
    it("should be cool with it", () => {
      expect(annotator.options.sha).to.equal(options.sha);
    });
    describe("and calling annotate on deployment", () => {
      it("should set the expected annotations", () => {
        const manifest = annotator.annotate(_.cloneDeep(originalManifest));
        expect(manifest.metadata.name).to.equal(originalManifest.metadata.name);
        expect(manifest.metadata.annotations[Annotations.UUID]).to.be.empty;
        expect(
          manifest.metadata.annotations[Annotations.OriginalName]
        ).to.equal(originalManifest.metadata.name);
        expect(
          manifest.metadata.annotations[Annotations.LastAppliedConfiguration]
        ).to.equal(JSON.stringify(originalManifest));
        expect(
          manifest.metadata.annotations[
            Annotations.LastAppliedConfigurationHash
          ]
        ).to.equal("5fe441d20dd25a28df2c84667aa9e611df83a6c3");
        expect(manifest.metadata.annotations[Annotations.Commit]).to.equal(
          JSON.stringify(options.sha)
        );
      });
      it("should set the annotations with existing", () => {
        let origManifest = _.cloneDeep(originalManifest);
        origManifest.spec.selector.matchLabels.strategy = "some-update";
        const manifest = annotator.annotate(_.cloneDeep(origManifest));
        expect(manifest.metadata.name).to.equal(origManifest.metadata.name);
        expect(manifest.spec.selector.matchLabels.strategy).to.equal(
          options.strategy.name
        );
        expect(
          manifest.metadata.annotations[Annotations.LastAppliedConfiguration]
        ).to.equal(JSON.stringify(origManifest));
      });
    });
    describe("and calling annotate on job", () => {
      it("should set the expected annotations", () => {
        const manifest = annotator.annotate(_.cloneDeep(originalJobManifest));
        expect(manifest.metadata.name).to.equal(
          originalJobManifest.metadata.name +
            "-f94274f6bdc905825d1616fe265bc6d2de773e7c"
        );
        expect(manifest.metadata.annotations[Annotations.UUID]).to.be.empty;
        expect(
          manifest.metadata.annotations[Annotations.OriginalName]
        ).to.equal(originalJobManifest.metadata.name);
        expect(
          manifest.metadata.annotations[Annotations.LastAppliedConfiguration]
        ).to.equal(JSON.stringify(originalJobManifest));
        expect(
          manifest.metadata.annotations[
            Annotations.LastAppliedConfigurationHash
          ]
        ).to.equal("f94274f6bdc905825d1616fe265bc6d2de773e7c");
        expect(manifest.metadata.annotations[Annotations.Commit]).to.equal(
          JSON.stringify(options.sha)
        );
      });
    });
  });
});
