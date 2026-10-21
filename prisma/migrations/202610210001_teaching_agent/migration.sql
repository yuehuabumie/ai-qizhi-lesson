-- Incremental change for an existing aiq_course database. Back up before applying.
-- This does not remove or rewrite any member, submission or assignment rows.
-- Apply once; the deployment runner must inspect schema state before retrying DDL.

ALTER TABLE `class_members`
  ADD COLUMN `studentNo` VARCHAR(40) NULL,
  ADD COLUMN `gender` VARCHAR(20) NULL,
  ADD COLUMN `score` DOUBLE NULL;
CREATE UNIQUE INDEX `class_members_classId_studentNo_key` ON `class_members`(`classId`, `studentNo`);
CREATE INDEX `class_members_classId_name_idx` ON `class_members`(`classId`, `name`);
DROP INDEX `class_members_classId_name_key` ON `class_members`;

CREATE TABLE `class_groups` (
  `id` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `class_groups_classId_name_key` (`classId`, `name`),
  INDEX `class_groups_classId_idx` (`classId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `class_groups_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classrooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `class_group_members` (
  `groupId` VARCHAR(30) NOT NULL,
  `memberId` VARCHAR(30) NOT NULL,
  UNIQUE INDEX `class_group_members_memberId_key` (`memberId`),
  PRIMARY KEY (`groupId`, `memberId`),
  CONSTRAINT `class_group_members_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `class_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `class_group_members_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `class_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `assignments`
  ADD COLUMN `quizJson` MEDIUMTEXT NULL,
  ADD COLUMN `scoresPublished` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `answersPublished` BOOLEAN NOT NULL DEFAULT false;
